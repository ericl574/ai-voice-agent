import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { sendSms, isSmsConfigured } from '@/lib/notify/sms';
import { rateLimit, clientKey } from '@/lib/rate-limit';

// Signed-in SMS test trigger for Settings → After-hours report. Sends one fixed, harmless message
// to the business's OWN configured SMS destination (agent_config.notify_sms_to, else the business
// phone) — never an arbitrary number from the request, so this can't be used as an open SMS relay.
//
// Twilio credentials stay server-side (notify/sms.ts); no secret is exposed. Independent of email —
// works whether or not NOTIFY_EMAIL_FROM is set. Auth uses the user's own cookie/RLS session (anon
// key), same pattern as /api/billing/status and /api/notify-status. Rate-limited so a stuck client
// can't burn Twilio cost.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function maskPhone(p: string): string {
  // Echo back only the last 4 digits so the user can confirm the target without us re-printing it.
  const digits = p.replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••';
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const rl = rateLimit(`test-sms:${clientKey(req, user.id)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Provider not configured (TWILIO_* env missing) → report cleanly, don't crash.
  if (!isSmsConfigured()) {
    return NextResponse.json({ ok: false, reason: 'sms_not_configured' });
  }

  const business = await getActiveBusiness(supabase);
  if (!business) return NextResponse.json({ ok: false, reason: 'no_business' });

  const cfg = business.agent_config ?? {};
  const to = (cfg.notify_sms_to?.trim() || business.phone || '').trim();
  if (!to) return NextResponse.json({ ok: false, reason: 'no_destination' });

  const r = await sendSms(
    to,
    'FrontDesk test alert — your SMS notifications are working. No action needed.',
  );
  return NextResponse.json({ ok: r.ok, reason: r.reason ?? null, to: maskPhone(to) });
}
