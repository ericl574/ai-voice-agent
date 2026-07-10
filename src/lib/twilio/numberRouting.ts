// Pure inbound-number → business routing for the Twilio phone path.
//
// No imports on purpose so the deterministic QA runner can load it (same pattern as digest.ts).
// The Twilio webhook (`/api/twilio/voice`) uses this to resolve WHICH business a call is for from
// the dialed number (params.To), so a single deployment serves many pilots instead of one
// env-pinned TWILIO_BUSINESS_ID. All Supabase/env access lives in the route, not here.

export interface BusinessNumberRow {
  id: string;
  twilio_number: string | null | undefined;
}

// Reduce any phone representation to comparable digits. NANP-aware: an 11-digit number with a
// leading '1' is the same as its 10-digit form, so '+1 604 555 0100', '16045550100', and
// '(604) 555-0100' all canonicalize equal. Empty / non-digit input → '' (never matches anything).
export function canonicalPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

// Resolve the business that owns the dialed number. Returns the id of the first row whose
// twilio_number canonicalizes equal to `dialedTo`, or null when none match. A blank dialed number
// or a blank stored number never matches — so a business without a mapped number is never picked up
// by accident.
export function matchBusinessIdByNumber(
  rows: BusinessNumberRow[],
  dialedTo: string | null | undefined,
): string | null {
  const target = canonicalPhone(dialedTo);
  if (!target) return null;
  for (const row of rows) {
    const stored = canonicalPhone(row.twilio_number);
    if (stored && stored === target) return row.id;
  }
  return null;
}
