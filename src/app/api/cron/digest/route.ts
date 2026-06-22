import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { SITE_URL } from '@/lib/site';
import type { AgentConfig } from '@/lib/supabase/businesses';
import {
  composeDigestEmail,
  composeDigestSms,
  buildCallsCsv,
  type DigestCall,
} from '@/lib/notify/digest';
import { sendEmail, isEmailConfigured } from '@/lib/notify/email';
import { sendSms, isSmsConfigured } from '@/lib/notify/sms';
import { notifyOps } from '@/lib/notify/ops';

// After-hours daily digest cron. Vercel Cron calls this HOURLY (vercel.json); for each business it
// sends the digest only when the LOCAL hour has reached the business's send hour (default 8am) and
// no digest has gone out for that local day yet. Decoupled from the call-save path — a digest
// failure can never affect saved calls. Demo calls are never saved, so they're excluded by nature.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is unset, the route
// refuses (so it's never an open endpoint). Storage uses the service-role admin client.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EPOCH = new Date(0).toISOString();

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Local hour (0–23) + local date (YYYY-MM-DD) for a timezone; falls back to UTC on a bad tz.
function localHourAndDate(timezone: string, at: Date): { hour: number; date: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    let hh = get('hour');
    if (hh === '24') hh = '00'; // some environments emit 24 for midnight
    return { hour: parseInt(hh, 10) || 0, date: `${get('year')}-${get('month')}-${get('day')}` };
  } catch {
    return { hour: at.getUTCHours(), date: at.toISOString().slice(0, 10) };
  }
}

async function processBusiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  biz: { id: string; name: string | null; timezone: string | null; phone: string | null; email: string | null; agent_config: AgentConfig | null },
  nowIso: string,
): Promise<'sent' | 'skipped'> {
  const cfg = biz.agent_config ?? {};
  const mode = cfg.delivery_mode ?? 'daily_digest';
  // Only digest modes are handled here; instant modes deliver per-call elsewhere.
  if (mode !== 'daily_digest' && mode !== 'after_hours_digest') return 'skipped';

  const tz = biz.timezone || 'America/Vancouver';
  const sendHour = typeof cfg.digest_send_hour === 'number' ? cfg.digest_send_hour : 8;
  const { hour, date } = localHourAndDate(tz, new Date(nowIso));
  // Send once the local time has reached the send hour (>= so a missed hourly tick still goes out).
  if (hour < sendHour) return 'skipped';

  // Idempotency: at most one digest per business per local day.
  const { data: already } = await admin
    .from('call_digests')
    .select('id')
    .eq('business_id', biz.id)
    .eq('digest_date', date)
    .maybeSingle();
  if (already) return 'skipped';

  // High-water mark: only include calls newer than the last digest.
  const { data: last } = await admin
    .from('call_digests')
    .select('covered_through')
    .eq('business_id', biz.id)
    .order('covered_through', { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = (last?.covered_through as string | undefined) ?? EPOCH;

  // Captured calls in the window. `*` so a missing next_action column (pre-migration) doesn't error.
  const { data: callRows, error: callErr } = await admin
    .from('calls')
    .select('*')
    .eq('business_id', biz.id)
    .gt('created_at', since)
    .lte('created_at', nowIso)
    .order('created_at', { ascending: true });
  if (callErr) {
    console.error(`[FD] digest: call query failed for ${biz.id}:`, callErr.message);
    await notifyOps({
      component: 'cron/digest',
      event: 'call_query_failed',
      error: callErr.message,
      context: { businessId: biz.id },
    });
    return 'skipped';
  }
  const rows = (callRows ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return 'skipped'; // nothing to report — don't send an empty digest

  // Preferred date/time come from any linked appointment.
  const callIds = rows.map((r) => r.id as string);
  const apptByCall = new Map<string, { date: string | null; time: string | null }>();
  const { data: appts } = await admin
    .from('appointments')
    .select('call_id, appointment_date, appointment_time')
    .in('call_id', callIds);
  for (const a of (appts ?? []) as Array<Record<string, unknown>>) {
    apptByCall.set(a.call_id as string, {
      date: (a.appointment_date as string | null) ?? null,
      time: (a.appointment_time as string | null) ?? null,
    });
  }

  const digestCalls: DigestCall[] = rows.map((r) => {
    const appt = apptByCall.get(r.id as string);
    return {
      callTimeIso: (r.started_at as string) || (r.created_at as string),
      callerName: (r.customer_name as string | null) ?? null,
      callerPhone: (r.customer_phone as string | null) ?? null,
      intent: (r.intent as string) || 'other',
      preferredDate: appt?.date ?? null,
      preferredTime: appt?.time ?? null,
      summary: (r.summary as string) || 'Call captured.',
      followUp: (r.next_action as string | null) ?? null,
    };
  });

  // Resolve destinations: explicit override, else the business's own email/phone.
  const emailTo = (cfg.notify_email_to?.trim() || biz.email)?.trim() || null;
  const smsTo = (cfg.notify_sms_to?.trim() || biz.phone)?.trim() || null;
  const businessName = biz.name ?? 'your business';

  let emailStatus: 'sent' | 'failed' | 'skipped' | 'disabled' = 'disabled';
  let smsStatus: 'sent' | 'failed' | 'skipped' | 'disabled' = 'disabled';

  // ── Email (readable summary + CSV) ─────────────────────────────────────────
  if (cfg.notify_email === true && emailTo) {
    if (!isEmailConfigured()) {
      emailStatus = 'skipped';
      console.warn('[FD] digest email skipped — provider not configured (RESEND_* env missing)');
    } else {
      const csvAttached = cfg.attach_csv !== false; // owner toggle; default attaches the CSV
      const { subject, text, html } = composeDigestEmail(
        { name: businessName, timezone: tz },
        digestCalls,
        `${SITE_URL.replace(/\/$/, '')}/dashboard/calls`,
        { csvAttached },
      );
      const attachments = csvAttached
        ? [{ filename: `after-hours-calls-${date}.csv`, content: Buffer.from(buildCallsCsv(digestCalls, tz), 'utf-8').toString('base64') }]
        : undefined;
      const r = await sendEmail(emailTo, subject, text, html, attachments);
      emailStatus = r.ok ? 'sent' : 'failed';
      console.log(`[FD] digest email (${biz.id}) → ${emailStatus}${r.reason ? ` (${r.reason})` : ''}`);
      if (!r.ok) {
        await notifyOps({
          component: 'cron/digest',
          event: 'email_send_failed',
          error: r.reason ?? 'provider failure',
          context: { businessId: biz.id },
        });
      }
    }
  }

  // ── SMS (one-line alert only) ──────────────────────────────────────────────
  if (cfg.notify_sms === true && smsTo) {
    if (!isSmsConfigured()) {
      smsStatus = 'skipped';
      console.warn('[FD] digest sms skipped — provider not configured (TWILIO_* env missing)');
    } else {
      const r = await sendSms(smsTo, composeDigestSms(digestCalls.length));
      smsStatus = r.ok ? 'sent' : 'failed';
      console.log(`[FD] digest sms (${biz.id}) → ${smsStatus}${r.reason ? ` (${r.reason})` : ''}`);
      if (!r.ok) {
        await notifyOps({
          component: 'cron/digest',
          event: 'sms_send_failed',
          error: r.reason ?? 'provider failure',
          context: { businessId: biz.id },
        });
      }
    }
  }

  // Record the digest (advances the high-water mark; unique(business_id, digest_date) blocks dupes).
  const { error: recErr } = await admin.from('call_digests').upsert(
    {
      business_id: biz.id,
      digest_date: date,
      covered_through: nowIso,
      call_count: digestCalls.length,
      email_status: emailStatus,
      sms_status: smsStatus,
      sent_at: nowIso,
    },
    { onConflict: 'business_id,digest_date' },
  );
  if (recErr) {
    console.error(`[FD] digest: could not record digest for ${biz.id}:`, recErr.message);
    await notifyOps({
      component: 'cron/digest',
      event: 'record_digest_failed',
      error: recErr.message,
      context: { businessId: biz.id },
    });
  }

  return 'sent';
}

async function runDigest(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[FD] digest cron called but CRON_SECRET is not set — refusing');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!secretsMatch(bearer, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error('[FD] digest cron: SUPABASE_SERVICE_ROLE_KEY missing');
    await notifyOps({
      component: 'cron/digest',
      event: 'storage_not_configured',
      error: 'SUPABASE_SERVICE_ROLE_KEY missing',
    });
    return NextResponse.json({ error: 'Server storage not configured' }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  const { data: businesses, error } = await admin
    .from('businesses')
    .select('id, name, timezone, phone, email, agent_config');
  if (error) {
    console.error('[FD] digest cron: business query failed:', error.message);
    await notifyOps({
      component: 'cron/digest',
      event: 'business_query_failed',
      error: error.message,
    });
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  let processed = 0;
  let sent = 0;
  for (const biz of (businesses ?? []) as Parameters<typeof processBusiness>[1][]) {
    processed++;
    try {
      const result = await processBusiness(admin, biz, nowIso);
      if (result === 'sent') sent++;
    } catch (err) {
      // One business failing must never stop the rest.
      console.error('[FD] digest: business failed (non-fatal):', err instanceof Error ? err.message : err);
      await notifyOps({
        component: 'cron/digest',
        event: 'business_processing_failed',
        error: err,
        context: { businessId: biz.id },
      });
    }
  }

  console.log(`[FD] digest cron complete — ${processed} businesses checked, ${sent} digests sent`);
  return NextResponse.json({ ok: true, processed, sent });
}

// Vercel Cron uses GET; allow POST too for manual/local triggering with the same auth.
export async function GET(req: NextRequest) {
  return runDigest(req);
}
export async function POST(req: NextRequest) {
  return runDigest(req);
}
