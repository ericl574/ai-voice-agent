// Deterministic past-time check for a captured appointment.
//
// A real-time voice model is unreliable at "is 5pm already in the past?" mid-call, so we verify it
// in CODE after the call: compare the requested local date+time to the current business-local time.
// Phase 1 uses this only to FLAG the booking for staff (in-call rejection is Phase 2). Self-contained
// (no imports) so the deterministic QA runner can load it.

// Current business-local wall clock as a fixed-width "YYYY-MM-DDTHH:MM" key (sorts chronologically).
function businessLocalKey(timezone: string, now: Date): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timezone || 'America/Vancouver');
  } catch {
    parts = fmt('America/Vancouver'); // unknown tz → safe default (never UTC, which shifts the date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let hh = get('hour');
  if (hh === '24') hh = '00'; // some environments emit 24 for midnight
  return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}`;
}

/**
 * True when the requested appointment date (YYYY-MM-DD) + time (HH:MM, in business-local time) is
 * before the current business-local time. Missing date or time → false (can't compare). Compares
 * fixed-width zero-padded keys, so a plain string comparison is chronological.
 */
export function isPastAppointment(
  date: string | null,
  time: string | null,
  timezone: string,
  now: Date,
): boolean {
  if (!date || !time) return false;
  const [h = '', m = ''] = time.split(':');
  const hhmm = `${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}`;
  return `${date}T${hhmm}` < businessLocalKey(timezone, now);
}
