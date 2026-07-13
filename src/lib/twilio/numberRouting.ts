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

// The routing decision for a REAL inbound Twilio call. Kept pure (no env/imports) so the fail-closed
// behavior is deterministically unit-tested; the route supplies the rows + the explicit pin.
//   - { kind: 'business' } → a resolved business; connect the call and save under it.
//   - { kind: 'reject' }   → UNRESOLVED; the route must fail closed: play a neutral unavailable
//                            message and hang up — never load the demo business, a default business,
//                            or another tenant, and never connect the bridge or save the call.
export type InboundRouting =
  | { kind: 'business'; businessId: string }
  | { kind: 'reject' };

// Resolve which business a real inbound call belongs to:
//   1. Match the dialed number (params.To) against businesses.twilio_number — the multi-tenant
//      production path (one dedicated hidden number per business).
//   2. Otherwise, ONLY an EXPLICIT single-tenant pin (TWILIO_BUSINESS_ID — an env the operator set on
//      purpose for a one-business/dev/test deployment) answers. This is NOT a production multi-number
//      fallback: it must be left UNSET in multi-number/pilot deployments, or an unmapped/mis-forwarded
//      number would wrongly answer as the pinned business.
//   3. Otherwise REJECT (fail closed). An unknown number never falls back to the demo/default tenant.
export function resolveInboundRouting(
  rows: BusinessNumberRow[],
  dialedTo: string | null | undefined,
  singleTenantPin?: string | null,
): InboundRouting {
  const matched = matchBusinessIdByNumber(rows, dialedTo);
  if (matched) return { kind: 'business', businessId: matched };
  const pin = (singleTenantPin ?? '').trim();
  if (pin) return { kind: 'business', businessId: pin };
  return { kind: 'reject' };
}

// Gate the single-tenant pin by environment. TWILIO_BUSINESS_ID is a local/dev/test convenience ONLY:
// in PRODUCTION it is always ignored (returns null), so real inbound routing is exclusively
// To → businesses.twilio_number and an accidentally-configured pin can never make an unresolved call
// answer as a real tenant. Pure (env passed in) so the production rule is unit-tested directly.
export function pinForEnv(nodeEnv: string | undefined, pin: string | null | undefined): string | null {
  if (nodeEnv === 'production') return null;
  const trimmed = (pin ?? '').trim();
  return trimmed ? trimmed : null;
}
