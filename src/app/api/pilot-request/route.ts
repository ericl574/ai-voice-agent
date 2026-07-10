import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, isEmailConfigured } from '@/lib/notify/email';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { SUPPORT_EMAIL, SITE_NAME } from '@/lib/site';
import { buildPilotLead } from '@/lib/leads/pilotLead';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOps } from '@/lib/notify/ops';

// Pilot signup form handler for /contact. Captures an inbound pilot lead.
//
// Where a lead goes (in priority order):
//   1. DURABLE STORAGE (source of truth): inserted into public.pilot_requests via the service-role
//      client. This is the record that must never be lost.
//   2. Email notification to SUPPORT_EMAIL when email is configured (Resend + verified sender) — a
//      best-effort heads-up, NOT the record of truth.
//   3. Server log — last-resort visibility only (rotates/expires; not durable).
// If storage is unconfigured/failing, an ops alert fires so the lead can be recovered from the log.
// Returns { ok } once the lead has been stored and/or notified.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rl = rateLimit(`pilot-request:${clientKey(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const built = buildPilotLead(body ?? {});
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const { lead } = built;

  // 1. Durable storage (source of truth). If it fails, we do NOT lose the lead: log it in full and
  //    fire an ops alert so it can be recovered, but still accept the submission for the visitor.
  let stored = false;
  const admin = createAdminClient();
  if (admin) {
    const { error } = await admin.from('pilot_requests').insert(lead);
    if (error) {
      console.error('[FD] pilot request: durable storage FAILED —', error.message);
      await notifyOps({
        component: 'pilot-request',
        event: 'lead_store_failed',
        error: error.message,
        context: { businessName: lead.business_name },
      });
    } else {
      stored = true;
    }
  } else {
    console.error('[FD] pilot request: SUPABASE_SERVICE_ROLE_KEY missing — lead not durably stored');
    await notifyOps({
      component: 'pilot-request',
      event: 'lead_store_unconfigured',
      error: 'SUPABASE_SERVICE_ROLE_KEY missing — lead stored only in logs',
      context: { businessName: lead.business_name },
    });
  }

  // Last-resort visibility (logs rotate/expire — durable storage above is the record of truth).
  console.log(
    `[FD] pilot request (stored=${stored}): business=${lead.business_name} | type=${lead.business_type} | ` +
      `contact=${lead.contact_name} | email=${lead.email} | phone=${lead.phone ?? '—'} | city=${lead.city ?? '—'}`,
  );

  // 2. Best-effort notify the support inbox when email delivery is configured. In no-domain mode
  //    this is a safe no-op — durable storage above is the capture.
  if (isEmailConfigured()) {
    const subject = `New pilot request — ${lead.business_name}`;
    const text = [
      `New ${SITE_NAME} pilot request:`,
      '',
      `Business:  ${lead.business_name}`,
      `Type:      ${lead.business_type}`,
      `Contact:   ${lead.contact_name}`,
      `Email:     ${lead.email}`,
      `Phone:     ${lead.phone ?? '—'}`,
      `City:      ${lead.city ?? '—'}`,
      '',
      'Message:',
      lead.message ?? '(none)',
    ].join('\n');
    await sendEmail(SUPPORT_EMAIL, subject, text);
  }

  return NextResponse.json({ ok: true });
}
