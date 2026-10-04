import { sql, json } from './_db.js';
import {
  SLOT_MINUTES,
  isoWeekday,
  minutesToTime,
  timeToMinutes,
  validDate,
  slotIsFuture
} from './_schedule.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const date = String(req.query?.date || '');
  const service = String(req.query?.service || 'auto');

  if (!validDate(date)) return json(res, 400, { error: 'Invalid date.' });
  if (!['auto', 'fast', 'after'].includes(service)) {
    return json(res, 400, { error: 'Invalid service.' });
  }

  const serviceType = service === 'after' ? 'after' : 'standard';
  const day = isoWeekday(date);

  try {
    const rules = await sql(
      `SELECT start_time::text, end_time::text, slot_minutes
       FROM availability_rules
       WHERE day_of_week = $1
         AND service_type = $2
         AND active = true
       ORDER BY start_time`,
      [day, serviceType]
    );

    const blocked = await sql(
      `SELECT start_time::text, end_time::text
       FROM availability_overrides
       WHERE override_date = $1::date
         AND service_type = $2
         AND action = 'block'
         AND active = true`,
      [date, serviceType]
    );

    const booked = await sql(
      `SELECT start_time::text
       FROM appointments
       WHERE appointment_date = $1::date
         AND (
           status = 'paid'
           OR (status = 'held' AND hold_expires_at > NOW())
         )`,
      [date]
    );

    const bookedStarts = new Set(
      booked.map(row => String(row.start_time).slice(0, 5))
    );

    const slots = [];

    for (const rule of rules) {
      const step = Number(rule.slot_minutes) || SLOT_MINUTES;
      const start = timeToMinutes(rule.start_time);
      const end = timeToMinutes(rule.end_time);

      for (let minute = start; minute + step <= end; minute += step) {
        const startTime = minutesToTime(minute);
        const endTime = minutesToTime(minute + step);

        const blockedByOverride = blocked.some(item =>
          minute < timeToMinutes(item.end_time) &&
          minute + step > timeToMinutes(item.start_time)
        );

        if (
          !bookedStarts.has(startTime) &&
          !blockedByOverride &&
          slotIsFuture(date, startTime)
        ) {
          slots.push({ start: startTime, end: endTime });
        }
      }
    }

    return json(res, 200, {
      date,
      service,
      timeZone: 'America/Chicago',
      slots
    });
  } catch (error) {
    console.error('Availability error', error);
    return json(res, 500, { error: 'Unable to load appointment availability.' });
  }
}
