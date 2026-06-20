import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEmailConfigured } from '@/lib/notify/email';
import { isSmsConfigured } from '@/lib/notify/sms';

// Read-only capability probe for the Settings → After-hours report UI.
//
// Returns ONLY booleans derived from isEmailConfigured()/isSmsConfigured() — never a key, value, or
// sender address. This lets the client (a 'use client' page that cannot read server-only env) show
// an accurate "production email is domain-gated" notice while NOTIFY_EMAIL_FROM is missing, and
// stop showing it automatically once a sender domain is configured. No secret is exposed.
//
// Auth: requires a signed-in user (same pattern as /api/billing/status) — infra status is only for
// owners configuring their report, not anonymous visitors. The auth check uses the user's own
// cookie/RLS-scoped session (anon key); no service role. A signed-out/demo caller gets 401, which
// the Settings page treats as "unknown" → it keeps the no-domain notice up (fail-safe).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // read env at request time; never cache the booleans

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    emailConfigured: isEmailConfigured(),
    smsConfigured: isSmsConfigured(),
  });
}
