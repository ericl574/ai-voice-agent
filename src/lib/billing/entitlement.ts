// Entitlement gate for PAID features. Access is granted only when a business has an operator-approved
// subscription. Onboarding stays concierge (Eric approves + bills manually — no self-serve checkout;
// that + automated Stripe lifecycle are Full-Level backlog). The Stripe webhook may also write
// `active`/`trialing` later, but today the operator sets the status by hand (typically `pilot`).
//
// Source of truth: billing_subscriptions.status (one row per business_id).

// Statuses that grant access. `pilot` is a manual, non-Stripe status Eric sets for approved pilots;
// `active`/`trialing` cover Stripe self-serve if/when it's wired.
export const ENTITLED_STATUSES = ['active', 'trialing', 'pilot'] as const;

// Pure: does this subscription status grant access to paid features? Case-insensitive; null/blank/
// unknown/canceled/past_due → false.
export function hasActiveEntitlement(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ENTITLED_STATUSES as readonly string[]).includes(status.trim().toLowerCase());
}

export interface EntitlementRead {
  status: string | null;
  entitled: boolean;
  // True when the billing row could not be read (DB/transport error). Callers should FAIL OPEN on a
  // read error (don't strand a likely-legit business on a transient blip) but FAIL CLOSED on a
  // confirmed non-entitled status.
  readError: boolean;
}

// Operator approval status parsing (for `npm run pilot:approve`). Maps the CLI arg to a concrete
// billing_subscriptions.status. `revoke` → `canceled` (a clearly non-entitled status that preserves
// billing history rather than deleting it). Pure so arg parsing + validation is unit-tested.
export type ApprovalParse =
  | { ok: true; status: string; entitled: boolean }
  | { ok: false; error: string };

export function normalizeApprovalStatus(raw: string | null | undefined): ApprovalParse {
  const arg = (raw ?? '').trim().toLowerCase();
  if (!arg || arg === 'pilot') return { ok: true, status: 'pilot', entitled: true };
  if (arg === 'revoke') return { ok: true, status: 'canceled', entitled: false };
  if (arg === 'active' || arg === 'trialing') return { ok: true, status: arg, entitled: hasActiveEntitlement(arg) };
  return { ok: false, error: `Status "${raw}" not allowed. Use: pilot | active | trialing | revoke` };
}

// Read a business's entitlement from billing_subscriptions. No row → not entitled (readError=false).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readBusinessEntitlement(db: any, businessId: string): Promise<EntitlementRead> {
  try {
    const { data, error } = await db
      .from('billing_subscriptions')
      .select('status')
      .eq('business_id', businessId)
      .maybeSingle();
    if (error) return { status: null, entitled: false, readError: true };
    const status = (data?.status as string | null) ?? null;
    return { status, entitled: hasActiveEntitlement(status), readError: false };
  } catch {
    return { status: null, entitled: false, readError: true };
  }
}
