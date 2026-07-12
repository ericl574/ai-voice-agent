import { NextRequest } from 'next/server';
import { isValidTwilioSignature } from '@/lib/twilio/signature';
import { SITE_URL } from '@/lib/site';
import { createAdminClient } from '@/lib/supabase/admin';
import { matchBusinessIdByNumber } from '@/lib/twilio/numberRouting';

// Twilio inbound voice webhook. Point the Twilio phone number's "A call comes in" webhook at
// {NEXT_PUBLIC_SITE_URL}/api/twilio/voice (HTTP POST). Responds with TwiML that:
//   1. speaks a short automated-front-desk disclosure, then
//   2. connects the call's audio to the FrontDesk bridge via Media Streams (<Connect><Stream>).
//
// The bridge (server/twilio-bridge.ts) relays audio between Twilio and OpenAI Realtime; it cannot
// run on Vercel (serverless has no durable WebSockets), so TWILIO_STREAM_URL points at wherever
// the bridge runs (local + ngrok for testing, or a small Node host). See docs/twilio-setup.md.
//
// Env: TWILIO_AUTH_TOKEN (signature validation), TWILIO_STREAM_URL (wss://…/twilio-stream),
//      TWILIO_BUSINESS_ID (optional single-tenant/dev fallback — production resolves the business from
//      the forwarded-to number via businesses.twilio_number; the demo business answers if neither matches).

export const runtime = 'nodejs';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

const DISCLOSURE =
  "Hi! You've reached the automated front desk. This call may be processed and summarized for the business. One moment while I connect you.";

// Resolve which business this inbound call is for, from the number it was dialed on (params.To).
// This is what makes the phone path multi-tenant: many Twilio numbers → many businesses via
// businesses.twilio_number, resolved by our own server (never trusting caller-supplied input).
// Fallback order: mapped number → legacy single-tenant TWILIO_BUSINESS_ID (local/dev) → '' (the
// demo business in session-config), so the line always answers even before a mapping exists.
async function resolveBusinessId(dialedTo: string): Promise<string> {
  const envFallback = process.env.TWILIO_BUSINESS_ID ?? '';
  const admin = createAdminClient();
  if (admin && dialedTo) {
    try {
      const { data, error } = await admin
        .from('businesses')
        .select('id, twilio_number')
        .not('twilio_number', 'is', null);
      // A query error (e.g. the twilio_number column not migrated yet) → keep legacy behavior.
      if (!error) {
        const matched = matchBusinessIdByNumber(
          (data ?? []) as { id: string; twilio_number: string | null }[],
          dialedTo,
        );
        if (matched) return matched;
        console.warn('[FD] twilio/voice: dialed number not mapped to a business — using TWILIO_BUSINESS_ID fallback');
      }
    } catch (err) {
      console.warn('[FD] twilio/voice: business-number lookup failed — using fallback:', (err as Error).message);
    }
  }
  return envFallback;
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Not configured — answer honestly and hang up rather than failing with a Twilio error tone.
    console.warn('[FD] twilio/voice called but TWILIO_AUTH_TOKEN is not set');
    return twiml(
      `<Say>${xmlEscape('This phone line is not fully set up yet. Please try again later.')}</Say><Hangup/>`,
    );
  }

  // Parse the form-encoded Twilio request and validate its signature.
  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    params = Object.fromEntries(
      [...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']),
    );
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // Twilio signs the URL it was configured with; behind Vercel's proxy req.url can differ in
  // scheme/host, so check the canonical public URL first and the raw request URL as fallback.
  const candidateUrls = [`${SITE_URL}/api/twilio/voice`, req.url];
  const signature = req.headers.get('x-twilio-signature');
  if (!isValidTwilioSignature(authToken, signature, candidateUrls, params)) {
    console.warn('[FD] twilio/voice rejected: invalid signature');
    return new Response('Invalid signature', { status: 403 });
  }

  const streamUrl = process.env.TWILIO_STREAM_URL;
  if (!streamUrl) {
    console.warn('[FD] twilio/voice: TWILIO_STREAM_URL not set — answering with setup notice');
    return twiml(
      `<Say>${xmlEscape('Thanks for calling. The front desk phone line is not fully set up yet. Please call back soon.')}</Say><Hangup/>`,
    );
  }

  const from = params.From ?? '';
  const to = params.To ?? '';
  const businessId = await resolveBusinessId(to);
  console.log(`[FD] twilio/voice inbound call ${params.CallSid ?? ''} from ${from} to ${to} → business ${businessId || '(demo fallback)'}`);

  // <Connect><Stream> = bidirectional media stream; custom parameters reach the bridge in the
  // stream's "start" message so it can resolve the business and report the caller id.
  return twiml(
    `<Say>${xmlEscape(DISCLOSURE)}</Say>` +
      `<Connect><Stream url="${xmlEscape(streamUrl)}">` +
      `<Parameter name="businessId" value="${xmlEscape(businessId)}"/>` +
      `<Parameter name="from" value="${xmlEscape(from)}"/>` +
      `<Parameter name="to" value="${xmlEscape(to)}"/>` +
      `</Stream></Connect>`,
  );
}
