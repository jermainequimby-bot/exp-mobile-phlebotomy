export const TIME_ZONE = 'America/Chicago';
export const SLOT_MINUTES = 45;

export function validDate(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isoWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function timeToMinutes(value) {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function chicagoNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value;
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    time: get('hour') + ':' + get('minute')
  };
}

export function slotIsFuture(date, time) {
  const now = chicagoNow();
  return date > now.date || (date === now.date && time > now.time);
}
