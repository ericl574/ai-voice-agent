// Timezone helpers for the call pipeline. Relative dates ("tomorrow", "Friday") must be
// resolved in the BUSINESS's local timezone — never the server/UTC clock, which caused
// appointments to land on the wrong day.

// Safe fallback when a business has no timezone saved. We deliberately do NOT fall back to UTC,
// because resolving "tomorrow" against UTC can shift the date for callers in the Americas.
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Vancouver';

// Returns today's date as YYYY-MM-DD in the given IANA timezone. 'en-CA' formats as YYYY-MM-DD.
// Invalid/empty tz falls back to DEFAULT_BUSINESS_TIMEZONE.
export function todayInTimeZone(timeZone?: string | null): string {
  const tz = timeZone || DEFAULT_BUSINESS_TIMEZONE;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // Unknown timezone string — fall back to the safe default rather than UTC.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
