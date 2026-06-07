import { NextRequest, NextResponse } from 'next/server';
import {
  resolveRuntimeVoice,
  DEFAULT_VOICE_OPTION,
  PREVIEW_SAMPLE_TEXT,
  PREVIEW_TTS_MODEL,
} from '@/lib/voice/voices';

// Live FALLBACK for the Settings "Test voice & speed" button — used only when the pre-generated
// static clip (public/voice-samples/<voice>.mp3) is missing. Synthesizes the sample line in the
// selected OpenAI voice and returns mp3. Speed is NOT applied here — the browser applies it via
// HTMLAudioElement.playbackRate so the preview matches the Realtime session's audio.output.speed.
//
// Uses the cheap `gpt-4o-mini-tts` model (mini), not the Realtime agent model (CLAUDE.md rule 17).
// API key stays server-side; the browser only receives audio bytes.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Voice preview is unavailable — OpenAI key not configured.' }, { status: 503 });
  }

  let body: { voice?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // Validate against the central config; fall back to the default voice.
  const voice = (resolveRuntimeVoice(body.voice) ?? DEFAULT_VOICE_OPTION).runtimeVoiceId;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PREVIEW_TTS_MODEL,
        voice,
        input: PREVIEW_SAMPLE_TEXT,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: `Voice preview failed (${res.status}): ${detail}` }, { status: 502 });
    }

    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
