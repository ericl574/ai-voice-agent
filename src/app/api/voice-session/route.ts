import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { AgentConfig, Business } from '@/lib/supabase/businesses';

const MODEL = 'gpt-realtime-mini';

// Global FrontDesk behavior rules — always injected regardless of business data
const GLOBAL_RULES = `BEHAVIOR RULES (FrontDesk):
- Fast, direct, natural front desk style. Keep replies short.
- Ask one question at a time. Never stack multiple questions in one reply.
- Never invent pricing, availability, services, or policies.
- If unsure, say staff will confirm and offer to take a message.
- You are a front desk assistant — never claim to be human.
- Do not overuse the word "AI".

LANGUAGE:
- Default language is English. Open and reply in English unless the caller clearly prefers another language.
- If the caller speaks another language clearly (a full sentence or an obvious greeting), switch to that language and continue in it.
- Once you have switched, stay in that language until the caller clearly switches again.
- Do not translate the caller's words. Match their language.
- Keep responses short, natural, and professional in any language.

SILENCE & UNCLEAR AUDIO:
- If the caller is silent, do NOT prompt them again. Wait quietly.
- If you only hear noise, a partial word, or audio you cannot understand clearly, do NOT respond. Wait for the caller to speak again.
- Never repeat "take your time" or chain follow-up prompts. One brief check-in is enough; then stay silent until you hear a clear sentence.
- Only respond when the caller's speech is clear enough that you understand the intent.

COLLECTING DETAILS:
- Only collect caller details when an appointment, callback, or service request is needed. Do NOT collect for general questions.
- For appointments: collect in order — (1) what service or reason, (2) preferred date, (3) preferred time, (4) caller name, (5) phone number if not provided. One question per reply.
- For callbacks or service requests: collect — (1) what they need help with, (2) name, (3) best phone number.
- Once you have service/reason, date, time, and name — confirm you have everything and tell them staff will follow up to confirm.`;

interface KnowledgeRow {
  id: string;
  category: string;
  question: string;
  answer: string;
}

function buildSystemPrompt(
  business: Business | null,
  agentConfig: AgentConfig | null,
  knowledge: KnowledgeRow[],
): string {
  if (!business) {
    return `You are a professional front desk voice assistant for a service business.\n\n${GLOBAL_RULES}`;
  }

  const name = business.name;
  const tone =
    agentConfig?.tone_tags?.join(', ') ||
    agentConfig?.tone ||
    'friendly, calm';
  const hours = agentConfig?.business_hours || 'not specified — let the caller know staff can confirm';
  const walkin = agentConfig?.walk_in_allowed ?? false;
  const requiresConfirmation = agentConfig?.appointments_require_confirmation ?? true;
  const callbackExp = agentConfig?.callback_expectation || 'staff will follow up during business hours';
  const handoffRule = agentConfig?.staff_handoff_rule || 'Escalate urgent, angry, or complex calls to staff.';

  const knowledgeLines =
    knowledge.length > 0
      ? knowledge.map((k) => `- [${k.category}] ${k.question}: ${k.answer}`).join('\n')
      : '(none provided — do not invent answers; offer to have staff follow up)';

  const customSection = agentConfig?.custom_instructions?.trim()
    ? `\nCUSTOM INSTRUCTIONS:\n${agentConfig.custom_instructions}`
    : '';

  return `You are the front desk voice assistant for ${name}${business.business_type ? `, a ${business.business_type.replace('_', ' ')} business` : ''}.

${GLOBAL_RULES}
Tone: ${tone}.

BUSINESS INFO:
Name: ${name}
${business.phone ? `Phone: ${business.phone}` : ''}
${business.city ? `Location: ${business.city}${business.region ? ', ' + business.region : ''}` : ''}
Timezone: ${business.timezone}
Hours: ${hours}
${walkin ? 'Walk-ins: Welcome.' : 'Appointments: Preferred. Walk-ins subject to availability.'}

APPOINTMENTS:
${requiresConfirmation ? 'NEVER confirm appointments yourself. Always say staff will confirm and provide the callback expectation.' : 'You may acknowledge appointment requests.'}
Callback expectation: ${callbackExp}

ESCALATION:
${handoffRule}

KNOWLEDGE BASE (Layer 2 — Q&A):
${knowledgeLines}
${customSection}`.trim();
}

export async function GET() {
  return NextResponse.json({ configured: !!process.env.OPENAI_API_KEY });
}

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 },
    );
  }

  // Try to build a personalized prompt from the authenticated user's business data
  let systemInstructions = `You are a professional front desk voice assistant.\n\n${GLOBAL_RULES}`;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const business = await getActiveBusiness(supabase);
      if (business) {
        const { data: knowledgeRows } = await supabase
          .from('business_knowledge')
          .select('id, category, question, answer')
          .eq('business_id', business.id)
          .order('category', { ascending: true });

        systemInstructions = buildSystemPrompt(
          business,
          business.agent_config as AgentConfig | null,
          (knowledgeRows as KnowledgeRow[]) ?? [],
        );
      }
    }
  } catch {
    // Fall through to generic instructions — never block a voice session due to a DB error
  }

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 300 },
        session: {
          type: 'realtime',
          model: MODEL,
          instructions: systemInstructions,
          // Conservative server VAD so background noise / breathing / partial words
          // do NOT chain-trigger redundant assistant responses.
          //   threshold: 0.50 (default) → 0.65 — caller must speak more clearly to be heard
          //   silence_duration_ms: 500 (default) → 1000 — wait a full second of silence
          //                                              before closing the turn
          //   prefix_padding_ms: 300 — include 0.3s before speech for natural starts
          // Per-turn caller transcription is enabled so each caller utterance arrives as its
          // own `conversation.item.input_audio_transcription.completed` event — needed so
          // Call History shows multiple Caller rows instead of one combined blob.
          audio: {
            input: {
              turn_detection: {
                type: 'server_vad',
                threshold: 0.65,
                prefix_padding_ms: 300,
                silence_duration_ms: 1000,
                create_response: true,
              },
              transcription: { model: 'whisper-1' },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `OpenAI API error (${res.status}): ${body}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ clientSecret: data.value });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
