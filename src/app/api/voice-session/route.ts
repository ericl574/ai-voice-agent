import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { AgentConfig } from '@/lib/supabase/businesses';
import { REALTIME_TRANSCRIPTION_MODEL, TRANSCRIPTION_LANGUAGE_HINT } from '@/lib/call-pipeline/constants';
import { buildSystemPrompt } from '@/lib/agents/core/promptBuilder';
import { getVertical } from '@/lib/agents/verticals/registry';
import type { KnowledgeRow } from '@/lib/agents/core/types';

const MODEL = 'gpt-realtime';

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

  // Build the prompt from the authenticated user's business data. The default (signed-out,
  // missing profile, or DB error) resolves to the generic vertical — made explicit and logged.
  let systemInstructions = buildSystemPrompt(null, null, []);
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
        console.log(
          `[FD] voice session vertical: ${getVertical(business.business_type).id} (business_type: ${business.business_type})`,
        );
      } else {
        console.log('[FD] voice session vertical: generic (no business profile)');
      }
    } else {
      console.log('[FD] voice session vertical: generic (signed-out)');
    }
  } catch {
    // Fall through to generic instructions — never block a voice session due to a DB error
    console.log('[FD] voice session vertical: generic (DB error fallback)');
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
          // `language` is a soft hint (default English, auto-switches on clearly non-English speech).
          audio: {
            input: {
              turn_detection: {
                type: 'server_vad',
                threshold: 0.65,
                prefix_padding_ms: 300,
                silence_duration_ms: 1000,
                create_response: true,
                // Do NOT let detected speech truncate the assistant mid-reply. Background
                // noise / nearby speech (or the assistant's own voice leaking into the mic)
                // was barging in and causing the assistant to cut off and repeat itself.
                // The assistant now finishes its turn; the next caller turn is handled after.
                interrupt_response: false,
              },
              transcription: {
                model: REALTIME_TRANSCRIPTION_MODEL,
                language: TRANSCRIPTION_LANGUAGE_HINT,
              },
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
