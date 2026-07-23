import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { AgentConfig } from '@/lib/supabase/businesses';
import { REALTIME_TRANSCRIPTION_MODEL, TRANSCRIPTION_LANGUAGE_HINT } from '@/lib/call-pipeline/constants';
import { buildSystemPrompt } from '@/lib/agents/core/promptBuilder';
import { getDemoBusiness } from '@/lib/agents/demoBusinesses';
import { getVertical } from '@/lib/agents/verticals/registry';
import type { KnowledgeRow } from '@/lib/agents/core/types';
import { requiredReservationFields } from '@/lib/call-pipeline/reservationDraft';
import { RESERVATION_TOOLS } from '@/lib/realtime/reservationTools';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { readBusinessEntitlement } from '@/lib/billing/entitlement';

const MODEL = 'gpt-realtime';

export async function GET() {
  return NextResponse.json({ configured: !!process.env.OPENAI_API_KEY });
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 },
    );
  }

  // Throttle paid session minting (best-effort per-instance) so a runaway client can't open
  // unbounded Realtime sessions. ~12/min/client.
  const rl = rateLimit(`voice-session:${clientKey(req)}`, 12, 60_000);
  if (!rl.ok) {
    console.warn('[FD] voice-session rate limited:', clientKey(req));
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Body: `{ demo, businessType, raw }`. The public landing "Try our service" demo sends `demo: true`
  // plus the picked service. The "API" control button additionally sends `raw: true` — same demo
  // surface (no auth, nothing saved), but the model is shipped with NONE of FrontDesk's layers (see
  // the raw session below). Safely ignored if the body is empty/invalid (dashboard test posts nothing).
  let isDemo = false;
  let isRaw = false;
  let requestedVertical: string | null = null;
  try {
    const body = await req.json();
    if (body && body.demo === true) isDemo = true;
    if (body && body.raw === true) isRaw = true;
    if (body && typeof body.businessType === 'string') requestedVertical = body.businessType;
  } catch {
    // no/invalid JSON body — fine, this endpoint also accepts an empty POST
  }
  // Business type that drives the canonical reservation required-field set (party_size for restaurant
  // only). Updated below once the real/demo business is resolved; the SAME helper the phone bridge
  // uses (via /api/twilio/session-config) computes the set, so the two paths cannot drift.
  let reservationBusinessType: string | null = requestedVertical;
  // Reservation function tools are registered + the prompt tool-rules are enabled ONLY for the
  // authenticated dashboard test call (the transport that HANDLES the tool calls — see
  // src/app/dashboard/voice/page.tsx). The public landing demo (`demo:true`, create_response:true,
  // handled by CallSimulatorDemo) and the no-business fallback never register them, so the model is
  // never told to call a tool that has no handler on that surface. Phone stays off (its own CP).
  let enableReservationTools = false;

  // Build the prompt from the authenticated user's business data. The default (missing profile
  // or DB error) resolves to the requested vertical, else the generic vertical.
  let systemInstructions = buildSystemPrompt(null, null, [], requestedVertical);

  // Landing demo: ALWAYS use the selected service's demo business and NEVER read the visitor's
  // account — even if they happen to be signed in. This keeps each service isolated and correct
  // (a Clinic demo must not adopt a signed-in restaurant's identity or mention takeout).
  if (isRaw) {
    // "API" control experiment: ship the model RAW — no instructions, no tools, no voice/noise/VAD
    // overrides (built below). No account read, nothing saved, still rate-limited above. Lets us A/B
    // whether FrontDesk's ~5–6k-token prompt layer, not the model, is what feels less capable.
    console.log('[FD] voice session: RAW (no prompt / OpenAI defaults) — control experiment');
  } else if (isDemo) {
    const demo = getDemoBusiness(requestedVertical);
    systemInstructions = demo
      ? buildSystemPrompt(demo.business, demo.agentConfig, demo.knowledge)
      : buildSystemPrompt(null, null, [], requestedVertical);
    reservationBusinessType = demo?.business.business_type ?? requestedVertical;
    console.log(`[FD] voice session vertical: ${requestedVertical ?? 'generic'} (isolated demo${demo ? '' : ' — no demo business, generic fallback'})`);
  } else {
    // Non-demo sessions require a signed-in user. This closes the anonymous cost surface:
    // paid Realtime sessions are minted only for the public landing demo (`demo: true`,
    // rate-limited above) or for authenticated dashboard test calls. Signed-out dashboard
    // demo visitors see a sign-in prompt instead (voice/page.tsx gates the Start button).
    let user = null;
    let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
    try {
      supabase = await createClient();
      ({ data: { user } } = await supabase.auth.getUser());
    } catch {
      // Auth unavailable (e.g. Supabase not configured) — treated as signed out below.
    }
    if (!user || !supabase) {
      return NextResponse.json(
        { error: 'Please sign in to place a test call. The live demo on the home page works without an account.' },
        { status: 401 },
      );
    }

    try {
      const business = await getActiveBusiness(supabase);
      if (business) {
        // Paid-feature gate: no test calls until the business is operator-approved
        // (billing_subscriptions.status ∈ active/trialing/pilot). Fail OPEN on a read error so a
        // billing-table blip never blocks a legit signed-in user. The landing demo path is unaffected.
        const ent = await readBusinessEntitlement(supabase, business.id);
        if (!ent.entitled && !ent.readError) {
          return NextResponse.json(
            { error: 'Your account is pending activation. Contact us to start your pilot and unlock test calls.' },
            { status: 402 },
          );
        }
        const { data: knowledgeRows } = await supabase
          .from('business_knowledge')
          .select('id, category, question, answer')
          .eq('business_id', business.id)
          .order('category', { ascending: true });

        const agentConfig = business.agent_config as AgentConfig | null;
        systemInstructions = buildSystemPrompt(
          business,
          agentConfig,
          (knowledgeRows as KnowledgeRow[]) ?? [],
          null,
          true, // reservation tools enabled: this authenticated dashboard session registers + handles them
        );
        enableReservationTools = true;
        reservationBusinessType = business.business_type;
        console.log(
          `[FD] voice session vertical: ${getVertical(business.business_type).id} (business_type: ${business.business_type})`,
        );
      } else {
        console.log('[FD] voice session vertical: generic (no business profile)');
      }
    } catch {
      // Fall through to generic instructions — never block a signed-in voice session due to a DB error
      console.log('[FD] voice session vertical: generic (DB error fallback)');
    }
  }

  // RAW control ("API" button): the model on OpenAI's own defaults — NO instructions, NO tools, NO
  // voice/speed/noise overrides. Only server VAD with auto-response so it replies when the caller
  // stops. This is the deliberate A/B against the full FrontDesk session below.
  const rawSession = {
    type: 'realtime',
    model: MODEL,
    audio: {
      input: {
        turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
      },
    },
  };

  const fullSession = {
    type: 'realtime',
    model: MODEL,
    instructions: systemInstructions,
    // Reservation function tools — registered ONLY for the authenticated dashboard session that
    // handles the calls (page.tsx). Gated together with the prompt tool-rules above so the tool
    // surface and the instructions to use it are always enabled/disabled as one unit.
    ...(enableReservationTools ? { tools: RESERVATION_TOOLS, tool_choice: 'auto' } : {}),
    // Browser turn-taking is now OpenAI's DEFAULT server VAD (no threshold/silence/noise/voice/speed
    // overrides) — the near-field WebRTC mic + echo cancellation make the defaults feel great, and the
    // custom semantic-VAD/voice/speed layer was removed as part of trusting the model's own settings.
    // (The phone bridge keeps its conservative REALTIME_VAD — its idle/reconnect logic assumes no
    // barge-in; see server/twilio-bridge.ts.) `create_response` is the ONE thing we still set here: it
    // is the Layer-2 architecture switch, not a tuning knob — APP-CONTROLLED (false) for the dashboard
    // test call (one response per turn after the noise/intent gate), SERVER auto-response (true) for the
    // landing demo. See docs/call-pipeline.md. Per-turn transcription stays on for Call History.
    audio: {
      input: {
        turn_detection: { type: 'server_vad', create_response: isDemo === true },
        transcription: {
          model: REALTIME_TRANSCRIPTION_MODEL,
          // Include `language` only when a hint is set. It is null by default so transcription
          // auto-detects the caller's language. Never pass an empty string. The assistant's default
          // response language is English via the prompt — independent of this transcription setting.
          ...(TRANSCRIPTION_LANGUAGE_HINT ? { language: TRANSCRIPTION_LANGUAGE_HINT } : {}),
        },
      },
    },
  };

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 300 },
        session: isRaw ? rawSession : fullSession,
      }),
    });

    if (!res.ok) {
      // Log the upstream detail server-side; never forward provider error bodies to the browser.
      console.error(`[FD] voice-session upstream error (${res.status}):`, await res.text());
      return NextResponse.json(
        { error: 'Could not start the call session. Please try again in a moment.' },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      clientSecret: data.value,
      // Canonical reservation required-field set (party_size for restaurant only) — same helper the
      // phone bridge receives via /api/twilio/session-config, so browser and phone can't drift.
      requiredFields: requiredReservationFields(
        reservationBusinessType,
        getVertical(reservationBusinessType).requiredFields,
      ),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
