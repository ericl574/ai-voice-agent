import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { buildSystemPrompt } from '@/lib/agents/core/promptBuilder';
import { getDemoBusiness } from '@/lib/agents/demoBusinesses';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentConfig } from '@/lib/supabase/businesses';
import type { KnowledgeRow } from '@/lib/agents/core/types';

// Bridge-only endpoint: returns the Realtime session config (instructions/voice/speed) for an
// inbound PHONE call. Guarded by the shared TWILIO_BRIDGE_SECRET — this is machine-to-machine
// (the bridge has no user session). Prompt assembly stays in buildSystemPrompt (source of truth);
// the bridge itself never sees Supabase.
//
// Business resolution is SERVER-pinned: the businessId comes from the TwiML <Parameter> that our own
// /api/twilio/voice route emitted — resolved from the number the call was FORWARDED TO (params.To →
// businesses.twilio_number), with the single-tenant TWILIO_BUSINESS_ID env only as a dev/back-compat
// fallback. It never comes from an end user.
//
// FAIL-CLOSED CONTRACT (Scope B): when a REAL businessId is supplied but its config cannot be loaded
// for ANY reason (not found, DB error, server misconfig, malformed data, unexpected exception), this
// route returns a 422 and NEVER the demo business — a real caller must never silently hear the demo
// restaurant, and the call must not be answered/saved under a mismatched identity. The bridge routes
// that 422 to its unavailable fail-closed message. The demo business answers ONLY when NO businessId
// is supplied (the landing-demo / local-dev path).

export const runtime = 'nodejs';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Fail-closed response for a REAL businessId whose session config could not be loaded. The body is
// generic — it carries NO secret and NO internal error detail — and the 422 status is what the bridge
// maps to its unavailable fail-closed path (server/twilio-bridge.ts sessionConfigDisposition →
// 'unresolved'). We NEVER fall back to the demo business for a real call.
function unresolvedResponse(): NextResponse {
  return NextResponse.json({ error: 'business_unavailable' }, { status: 422 });
}

// Phone-channel addendum, appended to whichever prompt we return. Caller id is known from the network
// — the agent may offer it back for callback confirmation but must never invent digits.
//
// FORWARDING CAVEAT (verify per carrier — see docs/call-forwarding-setup.md): `from` is assumed to be
// the ORIGINAL caller, which holds on most PSTN forwards. On some carriers a forwarded call can
// instead present the FORWARDING line (the merchant's own number) as `from`. The prompt only asks the
// caller to CONFIRM the number (never invents it), so a wrong `from` degrades to a clarifying question
// rather than a bad callback — but confirm the real behavior on an acceptance call.
function withPhoneNote(instructions: string, from: string | undefined): string {
  if (!from) return instructions;
  return (
    instructions +
    `\n\nPHONE CALL NOTE:\n- This is a real phone call. The caller's number from caller ID is ${from}. If they want a callback, confirm whether this number is the right one to use — do not re-ask for it digit by digit unless they want a different number.`
  );
}

export async function POST(req: NextRequest) {
  const secret = process.env.TWILIO_BRIDGE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Bridge not configured' }, { status: 503 });
  }
  if (!secretsMatch(req.headers.get('x-bridge-secret'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { businessId?: string; from?: string; callSid?: string };
  try {
    body = await req.json();
  } catch {
    // A secret-authenticated caller sending unparseable JSON is corruption/a bug, NOT a demo request
    // (legitimate demo requests send valid JSON — at least `{}`). Fail closed rather than silently
    // serve Demo; the generic 422 body carries no internal detail. Valid `{}` still reaches Demo below.
    console.error('[FD] twilio/session-config: malformed request body — failing closed.');
    return unresolvedResponse();
  }
  // CallSid is used only for log correlation (Twilio console ↔ bridge ↔ this route). Not caller PII.
  const callSid = typeof body.callSid === 'string' ? body.callSid : '';

  // ── REAL business path ──────────────────────────────────────────────────────────────────────
  // A businessId means a REAL inbound call our /api/twilio/voice already resolved from the dialed
  // number. If we cannot turn it into a usable session config for ANY reason, FAIL CLOSED (422) —
  // never answer as the demo business for a real call. Every branch below either returns the real
  // config or returns unresolvedResponse(); it never falls through to the demo tail.
  if (body.businessId) {
    try {
      const admin = createAdminClient();
      if (!admin) {
        console.error(
          `[FD] twilio/session-config: cannot serve businessId=${body.businessId} callSid=${callSid || '(none)'} ` +
            `— server storage not configured (no admin client). Failing closed.`,
        );
        return unresolvedResponse();
      }

      const { data: business, error: bizErr } = await admin
        .from('businesses')
        .select('*')
        .eq('id', body.businessId)
        .maybeSingle();
      if (bizErr) {
        console.error(
          `[FD] twilio/session-config: business lookup error for businessId=${body.businessId} ` +
            `callSid=${callSid || '(none)'} — ${bizErr.message}. Failing closed.`,
        );
        return unresolvedResponse();
      }
      if (!business) {
        console.error(
          `[FD] twilio/session-config: business NOT FOUND for businessId=${body.businessId} ` +
            `callSid=${callSid || '(none)'}. Failing closed (no demo fallback for a real call).`,
        );
        return unresolvedResponse();
      }

      // Knowledge is NON-critical: a KB read blip degrades to the REAL business prompt without its FAQ
      // (still the correct business, not demo), so we log and continue rather than fail closed.
      const { data: knowledgeRows, error: kbErr } = await admin
        .from('business_knowledge')
        .select('id, category, question, answer')
        .eq('business_id', business.id)
        .order('category', { ascending: true });
      if (kbErr) {
        console.warn(
          `[FD] twilio/session-config: knowledge load failed for businessId=${business.id} ` +
            `callSid=${callSid || '(none)'} — ${kbErr.message}. Continuing with the business prompt, no KB.`,
        );
      }

      const agentConfig = (business.agent_config as AgentConfig | null) ?? null;
      const instructions = buildSystemPrompt(business, agentConfig, (knowledgeRows as KnowledgeRow[]) ?? []);
      // Malformed/unusable business data → an empty or non-string prompt. Fail closed rather than ship
      // a blank session.
      if (typeof instructions !== 'string' || instructions.trim().length === 0) {
        console.error(
          `[FD] twilio/session-config: unusable prompt for businessId=${business.id} ` +
            `callSid=${callSid || '(none)'} (empty/malformed business data). Failing closed.`,
        );
        return unresolvedResponse();
      }

      let voice: string | null = null;
      let speed = 1.0;
      if (agentConfig?.voice_id) voice = agentConfig.voice_id;
      if (typeof agentConfig?.voice_speed === 'number') {
        speed = Math.min(1.25, Math.max(0.85, agentConfig.voice_speed));
      }
      return NextResponse.json({
        instructions: withPhoneNote(instructions, body.from),
        voice,
        speed,
        businessId: business.id as string,
        businessName: (business.name as string) ?? 'the business',
      });
    } catch (err) {
      // Any unexpected exception (e.g. buildSystemPrompt throwing) must also fail closed, NOT become a
      // 500 that the bridge would treat as a transient fallback.
      console.error(
        `[FD] twilio/session-config: unexpected error building config for businessId=${body.businessId} ` +
          `callSid=${callSid || '(none)'} — ${(err as Error)?.message ?? 'unknown'}. Failing closed.`,
      );
      return unresolvedResponse();
    }
  }

  // ── DEMO / dev path ─────────────────────────────────────────────────────────────────────────
  // Reached ONLY when NO businessId was supplied (the landing demo / local testing). Explicit + loud
  // so it can never be confused with a real business call in the logs.
  console.log(
    `[FD] twilio/session-config: no businessId provided — serving DEMO/dev instructions ` +
      `(vertical=${process.env.TWILIO_DEMO_VERTICAL ?? 'restaurant'}). Not a real business call.`,
  );
  const demo = getDemoBusiness(process.env.TWILIO_DEMO_VERTICAL ?? 'restaurant');
  const demoInstructions = demo
    ? buildSystemPrompt(demo.business, demo.agentConfig, demo.knowledge)
    : buildSystemPrompt(null, null, []);
  return NextResponse.json({
    instructions: withPhoneNote(demoInstructions, body.from),
    voice: null,
    speed: 1.0,
    businessId: null,
    businessName: demo?.business.name ?? 'the business',
  });
}
