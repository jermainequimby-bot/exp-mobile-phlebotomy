import { sql, json } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const sessionId = String(req.query?.session_id || '');
  if (!sessionId || sessionId.length > 200) {
    return json(res, 400, { error: 'Missing checkout session.' });
  }

  try {
    const rows = await sql(
      `SELECT
         id,
         appointment_date::text AS appointment_date,
         start_time::text AS start_time,
         end_time::text AS end_time,
         customer_name,
         customer_email,
         service_label,
         service_address,
         total,
         status
       FROM appointments
       WHERE stripe_session_id = $1
       LIMIT 1`,
      [sessionId]
    );

    if (!rows.length) return json(res, 404, { error: 'Booking not found yet.' });

    const booking = rows[0];

    return json(res, 200, {
      appointment: {
        id: booking.id,
        date: booking.appointment_date,
        start: String(booking.start_time).slice(0, 5),
        end: String(booking.end_time).slice(0, 5),
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        service: booking.service_label,
        address: booking.service_address,
        total: Number(booking.total),
        status: booking.status
      }
    });
  } catch (error) {
    console.error('Booking status error', error);
    return json(res, 500, { error: 'Unable to load booking status.' });
  }
}
