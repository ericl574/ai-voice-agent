import { NextRequest } from 'next/server';
import { isValidTwilioSignature } from '@/lib/twilio/signature';
import { SITE_URL } from '@/lib/site';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveInboundRouting, pinForEnv, type InboundRouting } from '@/lib/twilio/numberRouting';
import { readBusinessEntitlement } from '@/lib/billing/entitlement';
import { notifyOps } from '@/lib/notify/ops';

// Twilio inbound voice webhook. Point the Twilio phone number's "A call comes in" webhook at
// {NEXT_PUBLIC_SITE_URL}/api/twilio/voice (HTTP POST). Responds with TwiML that:
//   1. speaks a short automated-front-desk disclosure, then
//   2. connects the call's audio to the FrontDesk bridge via Media Streams (<Connect><Stream>).
//
// The bridge (server/twilio-bridge.ts) relays audio between Twilio and OpenAI Realtime; it cannot
// run on Vercel (serverless has no durable WebSockets), so TWILIO_STREAM_URL points at wherever
// the bridge runs (local + ngrok for testing, or a small Node host). See docs/twilio-setup.md.
//
// The business is resolved from the number the call was FORWARDED TO (params.To →
// businesses.twilio_number). An unresolved number FAILS CLOSED: neutral message + hangup, no bridge,
// no save — it never falls back to the demo business or another tenant (see resolveInboundRouting).
//
// Env: TWILIO_AUTH_TOKEN (signature validation), TWILIO_STREAM_URL (wss://…/twilio-stream),
//      TWILIO_BUSINESS_ID (EXPLICIT single-tenant/dev pin ONLY — leave UNSET in multi-number/pilot
//      deployments so unmapped numbers fail closed instead of answering as the pinned business).

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

// Shortest necessary transcription notice, played by Twilio before the media stream connects. No
// AI/service self-introduction and no filler — the merchant greeting is the first app-controlled
// response (the bridge triggers it via response.create using buildSystemPrompt's GREETING).
const DISCLOSURE = 'This call may be transcribed and summarized.';

// Played when the dialed number resolves to no business (fail-closed). Neutral and non-revealing —
// it must not expose that the number is unmapped or hint at internal routing.
const UNAVAILABLE_MESSAGE =
  "We're sorry, this answering service is temporarily unavailable. Please contact the business again later.";

// Resolve which business this inbound call is for, from the number it was dialed on (params.To).
// This is what makes the phone path multi-tenant: many Twilio numbers → many businesses via
// businesses.twilio_number, resolved by our own server (never trusting caller-supplied input).
// Returns a FAIL-CLOSED decision (see resolveInboundRouting): a matched business, an explicit
// single-tenant pin, or 'reject'. An unmapped number is REJECTED — never the demo/default tenant.
// A lookup error is also treated as no match (fail closed) rather than guessing a business.
async function resolveInboundBusiness(dialedTo: string): Promise<InboundRouting> {
  let rows: { id: string; twilio_number: string | null }[] = [];
  const admin = createAdminClient();
  if (admin) {
    try {
      const { data, error } = await admin
        .from('businesses')
        .select('id, twilio_number')
        .not('twilio_number', 'is', null);
      if (!error) rows = (data ?? []) as { id: string; twilio_number: string | null }[];
      else console.warn('[FD] twilio/voice: business-number lookup error — treating as no match:', error.message);
    } catch (err) {
      console.warn('[FD] twilio/voice: business-number lookup failed — treating as no match:', (err as Error).message);
    }
  }
  // Single-tenant/dev pin is IGNORED in production (pinForEnv → null): production inbound routing is
  // always To → businesses.twilio_number, so an accidentally-set TWILIO_BUSINESS_ID can never make an
  // unresolved production call answer as a real tenant. Outside production it's an explicit dev/test aid.
  const singleTenantPin = pinForEnv(process.env.NODE_ENV, process.env.TWILIO_BUSINESS_ID);
  return resolveInboundRouting(rows, dialedTo, singleTenantPin);
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
  const routing = await resolveInboundBusiness(to);

  // Fail closed: the dialed number resolves to no business. Do NOT connect the bridge, do NOT load a
  // demo/default business, do NOT save the call. Alert the operator (an unmapped inbound number means
  // mis-configured forwarding or an unmapped pilot number) and play a brief neutral message.
  if (routing.kind === 'reject') {
    console.warn(
      `[FD] twilio/voice REJECTED unresolved inbound call ${params.CallSid ?? ''} to ${to} — no business mapped to this number; failing closed`,
    );
    // Best-effort operator alert (cooldown-throttled; never throws). `to` is our own Twilio number,
    // not caller PII; the caller's `from` is intentionally omitted (the ops sanitizer redacts phones).
    await notifyOps({
      component: 'twilio/voice',
      event: 'unresolved_inbound_number',
      error: 'inbound To not mapped to any business',
      context: { to, callSid: params.CallSid ?? '' },
    });
    return twiml(`<Say>${xmlEscape(UNAVAILABLE_MESSAGE)}</Say><Hangup/>`);
  }

  const businessId = routing.businessId;

  // Paid-feature gate: only answer for an operator-approved business (billing_subscriptions.status ∈
  // active/trialing/pilot). Fail CLOSED on a confirmed non-entitled status; fail OPEN on a read error
  // (don't drop a caller of an already-provisioned, likely-legit business over a transient blip).
  const gateAdmin = createAdminClient();
  if (gateAdmin) {
    const ent = await readBusinessEntitlement(gateAdmin, businessId);
    if (!ent.entitled && !ent.readError) {
      console.warn(`[FD] twilio/voice: business ${businessId} not entitled (status=${ent.status ?? 'none'}) — failing closed`);
      await notifyOps({
        component: 'twilio/voice',
        event: 'business_not_entitled',
        error: `no active subscription`,
        context: { businessId, to, status: ent.status ?? 'none' },
      });
      return twiml(`<Say>${xmlEscape(UNAVAILABLE_MESSAGE)}</Say><Hangup/>`);
    }
  }

  console.log(`[FD] twilio/voice inbound call ${params.CallSid ?? ''} from ${from} to ${to} → business ${businessId}`);

  // <Connect><Stream> = bidirectional media stream; custom parameters reach the bridge in the
  // stream's "start" message so it can resolve the business and report the caller id.
  return twiml(
    `<Say>${xmlEscape(DISCLOSURE)}</Say>` +
      `<Connect><Stream url="${xmlEscape(streamUrl)}">` +
      `<Parameter name="businessId" value="${xmlEscape(businessId)}"/>` +
      `<Parameter name="from" value="${xmlEscape(from)}"/>` +
      `<Parameter name="to" value="${xmlEscape(to)}"/>` +
      // Carry the Twilio Call SID into the bridge so Railway logs are CallSid-correlated with the
      // Twilio console (and with this route's own inbound log line above).
      `<Parameter name="callSid" value="${xmlEscape(params.CallSid ?? '')}"/>` +
      `</Stream></Connect>`,
  );
}
