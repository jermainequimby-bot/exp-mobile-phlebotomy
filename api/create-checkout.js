import { sql, json } from './_db.js';
import {
  isoWeekday,
  minutesToTime,
  slotIsFuture,
  timeToMinutes,
  validDate
} from './_schedule.js';

const SERVICES = {
  local: { name: 'EXP Local', price: 60 },
  standard: { name: 'Standard EXP', price: 70 },
  fast: { name: 'Fast Track / Same-Day EXP', price: 95 },
  after: { name: 'After-Hours EXP', price: 90 }
};

function expectedFee(miles) {
  if (miles <= 10) return 0;
  if (miles <= 15) return 10;
  if (miles <= 20) return 20;
  if (miles <= 25) return 30;
  return null;
}

function add(form, key, value) {
  form.append(key, String(value));
}

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return json(res, 500, { error: 'Stripe is not configured yet.' });
    }

    const body = req.body || {};
    const service = clean(body.service, 20);
    const address = clean(body.address, 300);
    const quote = body.quote || {};
    const appointmentDate = clean(body.appointmentDate, 10);
    const startTime = clean(body.startTime, 5);
    const customerName = clean(body.customerName, 120);
    const customerEmail = clean(body.customerEmail, 160).toLowerCase();
    const customerPhone = clean(body.customerPhone, 40);

    if (!['auto', 'fast', 'after'].includes(service)) {
      return json(res, 400, { error: 'Invalid service.' });
    }
    if (address.length < 8) {
      return json(res, 400, { error: 'Please provide the complete service address.' });
    }
    if (!validDate(appointmentDate) || !/^\d{2}:\d{2}$/.test(startTime)) {
      return json(res, 400, { error: 'Please choose a valid appointment date and time.' });
    }
    if (!slotIsFuture(appointmentDate, startTime)) {
      return json(res, 409, { error: 'That appointment time has already passed. Please choose another slot.' });
    }
    if (customerName.length < 2) {
      return json(res, 400, { error: 'Please enter your name.' });
    }
    if (!validEmail(customerEmail)) {
      return json(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (customerPhone.length < 7) {
      return json(res, 400, { error: 'Please enter a valid phone number.' });
    }

    const miles = Number(quote.miles);
    const fee = expectedFee(miles);

    if (!Number.isFinite(miles) || fee === null || Number(quote.travelFee) !== fee) {
      return json(res, 400, {
        error: 'Travel quote is invalid or expired. Please calculate the total again.'
      });
    }

    const effectiveService = service === 'auto'
      ? (miles <= 10 ? 'local' : 'standard')
      : service;

    const selected = SERVICES[effectiveService];
    if (!selected) return json(res, 400, { error: 'Invalid service.' });

    const total = selected.price + fee;

    if (
      quote.service !== effectiveService ||
      Number(quote.total) !== total
    ) {
      return json(res, 400, {
        error: 'Price mismatch. Please calculate the total again.'
      });
    }

    const startMinutes = timeToMinutes(startTime);
    const endTime = minutesToTime(startMinutes + 45);
    const day = isoWeekday(appointmentDate);
    const serviceType = effectiveService === 'after' ? 'after' : 'standard';

    const ruleRows = await sql(
      `SELECT 1
       FROM availability_rules
       WHERE day_of_week = $1
         AND service_type = $2
         AND active = true
         AND start_time <= $3::time
         AND end_time >= $4::time
       LIMIT 1`,
      [day, serviceType, startTime, endTime]
    );

    if (!ruleRows.length) {
      return json(res, 409, {
        error: 'That time is not currently available for this service.'
      });
    }

    const blockedRows = await sql(
      `SELECT 1
       FROM availability_overrides
       WHERE override_date = $1::date
         AND service_type = $2
         AND action = 'block'
         AND active = true
         AND start_time < $4::time
         AND end_time > $3::time
       LIMIT 1`,
      [appointmentDate, serviceType, startTime, endTime]
    );

    if (blockedRows.length) {
      return json(res, 409, {
        error: 'That time is no longer available. Please choose another slot.'
      });
    }

    // Hold the slot for 35 minutes. The database unique constraint makes
    // simultaneous attempts for the same slot safe.
    const held = await sql(
      `INSERT INTO appointments (
         appointment_date,
         start_time,
         end_time,
         customer_name,
         customer_email,
         customer_phone,
         service,
         service_label,
         service_address,
         miles,
         base_price,
         travel_fee,
         total,
         status,
         hold_expires_at
       )
       VALUES (
         $1::date,
         $2::time,
         $3::time,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         'held',
         NOW() + INTERVAL '35 minutes'
       )
       ON CONFLICT (appointment_date, start_time)
       DO UPDATE SET
         end_time = EXCLUDED.end_time,
         customer_name = EXCLUDED.customer_name,
         customer_email = EXCLUDED.customer_email,
         customer_phone = EXCLUDED.customer_phone,
         service = EXCLUDED.service,
         service_label = EXCLUDED.service_label,
         service_address = EXCLUDED.service_address,
         miles = EXCLUDED.miles,
         base_price = EXCLUDED.base_price,
         travel_fee = EXCLUDED.travel_fee,
         total = EXCLUDED.total,
         status = 'held',
         hold_expires_at = EXCLUDED.hold_expires_at,
         stripe_session_id = NULL,
         stripe_payment_intent_id = NULL,
         updated_at = NOW()
       WHERE appointments.status = 'held'
         AND appointments.hold_expires_at <= NOW()
       RETURNING id`,
      [
        appointmentDate,
        startTime,
        endTime,
        customerName,
        customerEmail,
        customerPhone,
        effectiveService,
        selected.name,
        address,
        miles,
        selected.price,
        fee,
        total
      ]
    );

    if (!held.length) {
      return json(res, 409, {
        error: 'That appointment was just taken. Please choose another time.'
      });
    }

    const appointmentId = held[0].id;
    const origin =
      process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
        ? 'https://' + process.env.VERCEL_URL
        : (process.env.PUBLIC_SITE_URL || 'https://expmobilephlebotomy.com');

    const form = new URLSearchParams();
    add(form, 'mode', 'payment');
    add(form, 'line_items[0][quantity]', '1');
    add(form, 'line_items[0][price_data][currency]', 'usd');
    add(form, 'line_items[0][price_data][unit_amount]', Math.round(total * 100));
    add(form, 'line_items[0][price_data][product_data][name]', selected.name);
    add(
      form,
      'line_items[0][price_data][product_data][description]',
      fee ? 'Includes $' + fee + ' travel fee.' : 'Includes local travel.'
    );
    add(form, 'customer_email', customerEmail);
    add(form, 'phone_number_collection[enabled]', 'true');
    add(form, 'client_reference_id', String(appointmentId));
    add(form, 'success_url', origin + '/booking-success.html?session_id={CHECKOUT_SESSION_ID}');
    add(form, 'cancel_url', origin + '/booking.html?canceled=1');
    add(form, 'expires_at', Math.floor(Date.now() / 1000) + 30 * 60);

    add(form, 'metadata[appointment_id]', appointmentId);
    add(form, 'metadata[service]', effectiveService);
    add(form, 'metadata[appointment_date]', appointmentDate);
    add(form, 'metadata[start_time]', startTime);
    add(form, 'metadata[customer_email]', customerEmail);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      console.error('Stripe API error', response.status, JSON.stringify(data));
      await sql(
        `UPDATE appointments
         SET status = 'expired', hold_expires_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'held'`,
        [appointmentId]
      );

      return json(res, 400, {
        error: process.env.VERCEL_ENV === 'preview' && data?.error?.message
          ? 'Stripe error: ' + data.error.message
          : 'Unable to start secure checkout.'
      });
    }

    await sql(
      `UPDATE appointments
       SET stripe_session_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [data.id, appointmentId]
    );

    return json(res, 200, {
      url: data.url,
      appointmentId
    });
  } catch (error) {
    console.error('Stripe checkout error', error);
    return json(res, 500, { error: 'Unable to start secure checkout.' });
  }
}
