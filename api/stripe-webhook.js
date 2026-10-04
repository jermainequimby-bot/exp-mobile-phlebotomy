import crypto from 'node:crypto';
import { sql } from './_db.js';

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifySignature(payload, header, secret) {
  if (!header || !secret) throw new Error('Missing Stripe webhook signature or secret.');

  const parts = header.split(',').reduce((acc, item) => {
    const [key, value] = item.split('=');
    if (key && value) (acc[key] ??= []).push(value);
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];

  if (!timestamp || !signatures.length) {
    throw new Error('Invalid Stripe-Signature header.');
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    throw new Error('Webhook timestamp outside tolerance.');
  }

  const signedPayload = timestamp + '.' + payload.toString('utf8');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const matches = signatures.some(sig =>
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );

  if (!matches) throw new Error('Webhook signature verification failed.');
}

async function refundPayment(paymentIntent) {
  if (!paymentIntent || !process.env.STRIPE_SECRET_KEY) return null;

  const form = new URLSearchParams();
  form.append('payment_intent', paymentIntent);

  const response = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Stripe refund failed', response.status, JSON.stringify(data));
    throw new Error('Stripe refund failed.');
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = await rawBody(req);

    verifySignature(
      payload,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );

    const event = JSON.parse(payload.toString('utf8'));

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const appointmentId = Number(session.metadata?.appointment_id);

      if (!Number.isFinite(appointmentId)) {
        console.error('Stripe session missing appointment_id', session.id);
        return res.status(200).json({ received: true });
      }

      const rows = await sql.query(
        `SELECT id, status, hold_expires_at, stripe_payment_intent_id
         FROM appointments
         WHERE id = $1
         LIMIT 1`,
        [appointmentId]
      );

      if (!rows.length) {
        console.error('Appointment not found for Stripe session', appointmentId);
        return res.status(200).json({ received: true });
      }

      const appointment = rows[0];
      const paymentIntent =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || null;

      if (session.payment_status !== 'paid') {
        console.log('EXP checkout completed without paid status', session.id);
        return res.status(200).json({ received: true });
      }

      const paid = await sql.query(
        `UPDATE appointments
         SET status = 'paid',
             stripe_session_id = $1,
             stripe_payment_intent_id = $2,
             hold_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $3
           AND status = 'held'
           AND hold_expires_at > NOW()
         RETURNING id`,
        [session.id, paymentIntent, appointmentId]
      );

      if (paid.length) {
        console.log('EXP appointment confirmed', JSON.stringify({
          appointmentId,
          sessionId: session.id,
          amountTotal: session.amount_total
        }));
        return res.status(200).json({ received: true });
      }

      if (appointment.status === 'paid') {
        return res.status(200).json({ received: true });
      }

      await sql.query(
        `UPDATE appointments
         SET status = 'conflict',
             stripe_session_id = $1,
             stripe_payment_intent_id = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [session.id, paymentIntent, appointmentId]
      );

      try {
        await refundPayment(paymentIntent);
        console.error('EXP payment refunded because the appointment hold had expired', appointmentId);
      } catch (refundError) {
        console.error('URGENT: EXP payment requires manual refund', appointmentId, refundError);
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const appointmentId = Number(session.metadata?.appointment_id);

      if (Number.isFinite(appointmentId)) {
        await sql.query(
          `UPDATE appointments
           SET status = 'expired',
               hold_expires_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
             AND status = 'held'`,
          [appointmentId]
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error', error);
    return res.status(400).json({ error: 'Webhook verification failed.' });
  }
}
