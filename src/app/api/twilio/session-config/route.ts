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
// fallback. It never comes from an end user. When unresolved (or lookup fails), the demo business
// answers so the line still works for testing.

export const runtime = 'nodejs';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TWILIO_BRIDGE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Bridge not configured' }, { status: 503 });
  }
  if (!secretsMatch(req.headers.get('x-bridge-secret'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { businessId?: string; from?: string } = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }

  let instructions: string | null = null;
  let voice: string | undefined;
  let speed = 1.0;
  let businessId: string | null = null;
  let businessName = 'the business';

  // Real business path — requires the service-role key for a session-less server read.
  if (body.businessId) {
    const admin = createAdminClient();
    if (admin) {
      const { data: business } = await admin
        .from('businesses')
        .select('*')
        .eq('id', body.businessId)
        .maybeSingle();
      if (business) {
        const { data: knowledgeRows } = await admin
          .from('business_knowledge')
          .select('id, category, question, answer')
          .eq('business_id', business.id)
          .order('category', { ascending: true });
        const agentConfig = (business.agent_config as AgentConfig | null) ?? null;
        instructions = buildSystemPrompt(business, agentConfig, (knowledgeRows as KnowledgeRow[]) ?? []);
        if (agentConfig?.voice_id) voice = agentConfig.voice_id;
        if (typeof agentConfig?.voice_speed === 'number') {
          speed = Math.min(1.25, Math.max(0.85, agentConfig.voice_speed));
        }
        businessId = business.id as string;
        businessName = (business.name as string) ?? businessName;
      }
    } else {
      console.warn('[FD] twilio/session-config: SUPABASE_SERVICE_ROLE_KEY missing — demo fallback');
    }
  }

  // Demo fallback (no TWILIO_BUSINESS_ID, unknown id, or no admin key): the line still answers,
  // as the demo business for TWILIO_DEMO_VERTICAL (default restaurant). Calls are not saved.
  if (!instructions) {
    const demo = getDemoBusiness(process.env.TWILIO_DEMO_VERTICAL ?? 'restaurant');
    instructions = demo
      ? buildSystemPrompt(demo.business, demo.agentConfig, demo.knowledge)
      : buildSystemPrompt(null, null, []);
    businessName = demo?.business.name ?? businessName;
  }

  // Phone-channel addendum: caller id is known from the network — the agent may offer it back
  // for callback confirmation but must still never invent digits.
  //
  // FORWARDING CAVEAT (verify per carrier — see docs/call-forwarding-setup.md): `from` is assumed to
  // be the ORIGINAL caller, which holds on most PSTN forwards. On some carriers a forwarded call can
  // instead present the FORWARDING line (the merchant's own number) as `from`. The prompt only asks
  // the caller to CONFIRM the number (never invents it), so a wrong `from` degrades to a clarifying
  // question rather than a bad callback — but confirm the real behavior on an acceptance call.
  if (body.from) {
    instructions += `\n\nPHONE CALL NOTE:\n- This is a real phone call. The caller's number from caller ID is ${body.from}. If they want a callback, confirm whether this number is the right one to use — do not re-ask for it digit by digit unless they want a different number.`;
  }

  return NextResponse.json({ instructions, voice: voice ?? null, speed, businessId, businessName });
}
