// Helpers for the in-app "Delete account & all data" flow (/api/account/delete). The actual deletion
// runs ATOMICALLY in Postgres via the RPC public.delete_business_data (migration 20260714000000) — a
// single-transaction function so a mid-delete failure rolls back everything. This module holds the
// table-coverage source of truth + the pure multi-business decision logic (both unit-tested).

// Business-owned tables the RPC deletes. Source of truth for the migration-coverage test: every table
// here MUST appear in delete_business_data, and the NON_BUSINESS_TABLES must NOT.
export const BUSINESS_OWNED_TABLES = [
  'call_messages',       // via calls (no business_id)
  'calls',
  'appointments',
  'service_requests',
  'business_knowledge',
  'customers',
  'call_digests',
  'billing_subscriptions',
  'business_members',
  'businesses',          // parent — deleted last
] as const;

// Intentionally NOT deleted by delete_business_data: profiles is user-scoped (the route removes the
// auth user separately, only when it was the user's last membership); pilot_requests is a GLOBAL lead
// store shared across the app, not owned by any single business.
export const NON_BUSINESS_TABLES = ['profiles', 'pilot_requests'] as const;

// Multi-business safety: is the business being deleted the user's ONLY membership? If so, the route
// also removes the profile + auth user; otherwise the user keeps their login and other businesses.
export function isSoleMembership(
  memberships: Array<{ business_id: string }>,
  deletedBusinessId: string,
): boolean {
  const distinct = new Set(memberships.map((m) => m.business_id));
  distinct.delete(deletedBusinessId);
  return distinct.size === 0;
}

export interface DeletionOutcome {
  authUserRemoved: boolean;
  redirect: 'home' | 'dashboard';
  // True when business data was deleted but the auth-user removal failed (sole membership only) — a
  // recoverable state support can finish. The UI must NOT claim a full success in this case.
  partial: boolean;
}

// Decide the post-deletion outcome. Sole membership → remove the auth user and go home; if that
// removal failed, it's a partial success (data gone, orphaned login left for support). Other
// memberships remain → keep the login and send the user to their next business's dashboard.
export function postDeletionOutcome(isSole: boolean, authDeleteOk: boolean): DeletionOutcome {
  if (!isSole) return { authUserRemoved: false, redirect: 'dashboard', partial: false };
  if (authDeleteOk) return { authUserRemoved: true, redirect: 'home', partial: false };
  return { authUserRemoved: false, redirect: 'home', partial: true };
}
