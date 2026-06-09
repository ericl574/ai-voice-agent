// Timezone helpers for the call pipeline. Relative dates ("tomorrow", "Friday") must be
// resolved in the BUSINESS's local timezone — never the server/UTC clock, which caused
// appointments to land on the wrong day.

// Safe fallback when a business has no timezone saved. We deliberately do NOT fall back to UTC,
// because resolving "tomorrow" against UTC can shift the date for callers in the Americas.
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Vancouver';

// Returns the current local wall-clock in the given IANA timezone as a human-readable stamp the
// agent can speak and reason about, e.g. "Saturday, June 8, 2026 at 3:45 PM". Invalid/empty tz
// falls back to DEFAULT_BUSINESS_TIMEZONE. Injected into the system prompt at session creation so
// the agent knows the current business-local time (for "what time is it?" and same-day past-time
// checks) without asking the caller.
export function nowInTimeZone(timeZone?: string | null): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(new Date())
      // "Saturday, June 8, 2026, 3:45 PM" → "Saturday, June 8, 2026 at 3:45 PM"
      .replace(/,\s(?=\d{1,2}:\d{2}\s?[AP]M)/i, ' at ');
  try {
    return fmt(timeZone || DEFAULT_BUSINESS_TIMEZONE);
  } catch {
    return fmt(DEFAULT_BUSINESS_TIMEZONE);
  }
}

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
