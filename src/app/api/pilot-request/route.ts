import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, isEmailConfigured } from '@/lib/notify/email';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { SUPPORT_EMAIL, SITE_NAME } from '@/lib/site';

// Pilot signup form handler for /contact. Captures an inbound pilot lead.
//
// Where a lead goes:
//   • Email configured (RESEND_API_KEY + NOTIFY_EMAIL_FROM) → emailed to SUPPORT_EMAIL.
//   • Email NOT configured → logged server-side ONLY, as a TEMPORARY fallback. Server logs are NOT
//     durable lead storage — they rotate/expire, so leads can be lost.
// Before public use, configure RESEND_API_KEY, NOTIFY_EMAIL_FROM, and a real SUPPORT_EMAIL — or add
// DB lead storage. Returns { ok } once the lead has been emailed and/or logged.

export const runtime = 'nodejs';

interface PilotBody {
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  businessType?: string;
  city?: string;
  message?: string;
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`pilot-request:${clientKey(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: PilotBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const businessName = clean(body.businessName, 120);
  const contactName = clean(body.contactName, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const businessType = clean(body.businessType, 40) || 'other';
  const city = clean(body.city, 120);
  const message = clean(body.message, 2000);

  if (!businessName || !contactName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Please include your business name, your name, and a valid email.' },
      { status: 400 },
    );
  }

  // Temporary fallback only (NOT durable storage): grep `[FD] pilot request` in the server logs.
  // Logs rotate/expire — configure email (or DB lead storage) before relying on this in public.
  const lead =
    `business=${businessName} | type=${businessType} | contact=${contactName} | ` +
    `email=${email} | phone=${phone || '—'} | city=${city || '—'}`;
  console.log(`[FD] pilot request: ${lead}${message ? ` | message=${message}` : ''}`);

  // Best-effort notify the support inbox when email delivery is configured (Resend + verified
  // sender). In no-domain mode this is a safe no-op — the log above is the capture.
  if (isEmailConfigured()) {
    const subject = `New pilot request — ${businessName}`;
    const text = [
      `New ${SITE_NAME} pilot request:`,
      '',
      `Business:  ${businessName}`,
      `Type:      ${businessType}`,
      `Contact:   ${contactName}`,
      `Email:     ${email}`,
      `Phone:     ${phone || '—'}`,
      `City:      ${city || '—'}`,
      '',
      'Message:',
      message || '(none)',
    ].join('\n');
    await sendEmail(SUPPORT_EMAIL, subject, text);
  }

  return NextResponse.json({ ok: true });
}
