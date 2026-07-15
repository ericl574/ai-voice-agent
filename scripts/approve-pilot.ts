// Operator approval — grant (or revoke) a business's access to PAID features by setting its
// subscription status. Concierge model: Eric approves + bills manually; there is no self-serve
// checkout (that + automated Stripe lifecycle are Full-Level backlog). Billing analog of
// scripts/map-business-number.ts.
//
// Run:  npm run pilot:approve -- <business_id> [status]
//   approve as a pilot (default):   npm run pilot:approve -- 3f2a…
//   approve as active/trialing:     npm run pilot:approve -- 3f2a… active
//   revoke access (→ 'canceled'):   npm run pilot:approve -- 3f2a… revoke
//   read-only (show current):       npm run pilot:approve -- 3f2a… --show
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the npm script loads .env.local).
// If the service-role key isn't available locally, set the row in Supabase Studio →
// billing_subscriptions (business_id + status='pilot') instead. Never prints secrets.
//
// Idempotent + safe: on an existing row it updates ONLY status + updated_at (never touching
// stripe_customer_id, stripe_subscription_id, plan, or current_period_end); otherwise it inserts a
// minimal row. Revoke sets 'canceled' (preserves billing history rather than deleting the row).

import { createAdminClient } from '../src/lib/supabase/admin.ts';
import { normalizeApprovalStatus, hasActiveEntitlement } from '../src/lib/billing/entitlement.ts';

function fail(msg: string): never {
  console.error(`\n✗  ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [businessId, rawStatus] = process.argv.slice(2);
  if (!businessId) fail('Usage: npm run pilot:approve -- <business_id> [pilot|active|trialing|revoke|--show]');

  const admin = createAdminClient();
  if (!admin) {
    fail(
      'Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n' +
        "   (or set the row in Supabase Studio → billing_subscriptions: business_id + status='pilot').",
    );
  }

  // Validate the business exists.
  const { data: biz, error: bizErr } = await admin
    .from('businesses')
    .select('id, name')
    .eq('id', businessId)
    .maybeSingle();
  if (bizErr) fail(`Lookup failed: ${bizErr.message}`);
  if (!biz) fail(`No business found with id ${businessId}.`);

  const { data: current } = await admin
    .from('billing_subscriptions')
    .select('status, plan, stripe_customer_id, updated_at')
    .eq('business_id', businessId)
    .maybeSingle();

  console.log(`\n✓  Business: ${biz.name ?? '(unnamed)'}  [${businessId}]`);
  console.log(`   current status: ${current?.status ?? '(no subscription row)'}  →  entitled: ${hasActiveEntitlement(current?.status)}`);

  // Read-only mode.
  if (!rawStatus || rawStatus === '--show') {
    if (!rawStatus) console.log('\n(read-only — pass a status to set it: pilot | active | trialing | revoke)');
    return;
  }

  const parsed = normalizeApprovalStatus(rawStatus);
  if (!parsed.ok) fail(parsed.error);
  const { status, entitled } = parsed;

  // Update ONLY status + updated_at on an existing row (never clobber Stripe fields); else insert minimal.
  let writeErr: string | null = null;
  if (current) {
    const { error } = await admin
      .from('billing_subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('business_id', businessId);
    writeErr = error?.message ?? null;
  } else {
    const { error } = await admin
      .from('billing_subscriptions')
      .insert({ business_id: businessId, status, updated_at: new Date().toISOString() });
    writeErr = error?.message ?? null;
  }
  if (writeErr) fail(`Could not set status: ${writeErr}`);

  console.log(`\n✓  Set ${biz.name ?? businessId} → status='${status}'  (paid features ${entitled ? 'ENABLED' : 'DISABLED'})`);
  console.log(
    entitled
      ? '   The phone answering service + browser test calls are now unlocked for this business.'
      : '   Access removed: inbound calls fail closed and test calls are blocked. Billing history preserved.',
  );
}

void main();
