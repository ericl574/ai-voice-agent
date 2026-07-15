import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { isSoleMembership, postDeletionOutcome } from '@/lib/account/deleteAccount';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { notifyOps } from '@/lib/notify/ops';

// POST /api/account/delete — the in-app "Delete account & all data" action. Authenticated; the caller
// must be the OWNER of their own active business and must confirm by typing the exact business name
// AND the literal word DELETE. Deletion of all business-owned data runs ATOMICALLY in Postgres via the
// delete_business_data RPC (rolls back on any failure). The auth user is removed only when the deleted
// business was the caller's LAST membership; multi-business users keep their login and other data.
//
// Uses the service-role admin client for the RPC + auth-user removal, but ONLY after authorizing the
// signed-in user as the owner of their OWN resolved business — never on a client-supplied id.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Destructive + irreversible — rate-limit per user to blunt abuse of a leaked session.
  const rl = rateLimit(`account-delete:${clientKey(req, user.id)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 });
  }

  let confirmName = '';
  let confirmDelete = '';
  try {
    const body = (await req.json()) as { confirmName?: string; confirmDelete?: string };
    confirmName = (body.confirmName ?? '').trim();
    confirmDelete = (body.confirmDelete ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Resolve the caller's OWN active business (user_id-scoped — never a business they don't belong to,
  // never a client-supplied id).
  const business = await getActiveBusiness(supabase);
  if (!business) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Server not configured for account deletion' }, { status: 503 });
  }

  // Authorize: only the OWNER may delete the whole business + account.
  const { data: membership, error: memErr } = await admin
    .from('business_members')
    .select('role')
    .eq('business_id', business.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (memErr) {
    return NextResponse.json({ error: 'Could not verify account ownership' }, { status: 500 });
  }
  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the business owner can delete the account. Please contact support.' },
      { status: 403 },
    );
  }

  // Dual typed confirmation: exact business name AND the literal word DELETE.
  const expectedName = business.name?.trim() || 'DELETE';
  if (confirmName !== expectedName) {
    return NextResponse.json(
      { error: 'Confirmation text did not match. Type your business name exactly to confirm.' },
      { status: 400 },
    );
  }
  if (confirmDelete.toUpperCase() !== 'DELETE') {
    return NextResponse.json({ error: 'Please type DELETE to confirm.' }, { status: 400 });
  }

  // Multi-business: does the user belong to any OTHER business? Read BEFORE the delete removes this
  // membership, so we can decide whether to also remove the auth user.
  const { data: memberships, error: mmErr } = await admin
    .from('business_members')
    .select('business_id')
    .eq('user_id', user.id);
  if (mmErr) {
    return NextResponse.json({ error: 'Could not verify account memberships' }, { status: 500 });
  }
  const sole = isSoleMembership(memberships ?? [], business.id);

  // Atomic delete of ALL business-owned data (single transaction — rolls back on any failure).
  const { error: rpcErr } = await admin.rpc('delete_business_data', { p_business_id: business.id });
  if (rpcErr) {
    console.error('[FD] account/delete: delete_business_data RPC failed:', rpcErr.message);
    await notifyOps({
      component: 'account/delete',
      event: 'business_delete_failed',
      error: rpcErr.message,
      context: { businessId: business.id },
    });
    return NextResponse.json(
      { error: 'Deletion failed and was rolled back — no data was removed. Please contact support.' },
      { status: 500 },
    );
  }

  // Business data is gone. If this was the user's LAST business, also remove the profile + auth user.
  let authDeleteOk = true;
  if (sole) {
    const { error: profileErr } = await admin.from('profiles').delete().eq('id', user.id);
    if (profileErr) console.warn('[FD] account/delete: profile row delete failed:', profileErr.message);

    const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
    authDeleteOk = !authErr;
    if (authErr) {
      // Data is deleted but the login remains — a recoverable partial state for support to finish.
      console.warn('[FD] account/delete: auth user delete failed:', authErr.message);
      await notifyOps({
        component: 'account/delete',
        event: 'auth_user_delete_failed',
        error: authErr.message,
        context: { businessId: business.id, userId: user.id },
      });
    }
  }

  const outcome = postDeletionOutcome(sole, authDeleteOk);

  // Sign out server-side when the business is gone (sole membership). Multi-business users keep their
  // session and move to their next business's dashboard.
  if (sole) {
    try {
      await supabase.auth.signOut();
    } catch {
      /* session already invalidated with the auth user */
    }
  }

  return NextResponse.json({
    ok: true,
    businessDeleted: true,
    partial: outcome.partial,
    authUserRemoved: outcome.authUserRemoved,
    redirect: outcome.redirect,
  });
}
