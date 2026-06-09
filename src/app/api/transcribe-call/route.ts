import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BATCH_TRANSCRIPTION_MODEL, TRANSCRIPTION_LANGUAGE_HINT } from '@/lib/call-pipeline/constants';
import { CALLER_LABEL } from '@/lib/call-pipeline/transcript';

// FALLBACK transcription path. The live Realtime transcript is the primary source of truth (see
// buildTranscript + docs/call-pipeline.md §4); this route only runs when no usable Realtime caller
// turns were captured. It transcribes the recorded caller mic audio with batch Whisper and writes
// calls.transcript ONLY when the existing transcript is empty/placeholder — it must never overwrite
// a good Realtime transcript.

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const audioFile = formData.get('audio') as File | null;
  const callId = formData.get('call_id') as string | null;
  const businessId = formData.get('business_id') as string | null;
  const assistantTranscript = ((formData.get('assistant_transcript') as string) ?? '').trim();

  if (!audioFile || !callId || !businessId) {
    return NextResponse.json(
      { error: 'Missing required fields: audio, call_id, business_id' },
      { status: 400 },
    );
  }

  // Auth + ownership check — rejects requests without a valid session
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: callRow } = await supabase
    .from('calls')
    .select('id, transcript')
    .eq('id', callId)
    .eq('business_id', businessId)
    .single();
  if (!callRow) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // ── Transcribe caller audio with Whisper ─────────────────────────────────────

  const whisperForm = new FormData();
  whisperForm.append('file', audioFile, audioFile.name || 'caller-audio.webm');
  whisperForm.append('model', BATCH_TRANSCRIPTION_MODEL);
  // Language hint is unset by default → auto-detect (matches the Realtime path). Only append when
  // a hint is configured; never append a null/empty value.
  if (TRANSCRIPTION_LANGUAGE_HINT) whisperForm.append('language', TRANSCRIPTION_LANGUAGE_HINT);
  // verbose_json gives word-level timestamps; json gives {text} — json is sufficient for now
  whisperForm.append('response_format', 'json');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
  });

  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    return NextResponse.json(
      { error: `Whisper transcription failed (${whisperRes.status}): ${errText}` },
      { status: 502 },
    );
  }

  const whisperData = await whisperRes.json();
  const rawCallerText = ((whisperData.text as string) ?? '').trim();

  // ── Assemble official combined transcript ─────────────────────────────────────
  // Format each caller sentence with Caller: prefix so callerLinesOnly() in extraction
  // can correctly isolate caller turns from assistant turns.
  // Whisper may return multi-sentence text; prefix each line individually.

  const callerLines = rawCallerText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${CALLER_LABEL} ${l}`)
    .join('\n');

  // Place caller block after assistant lines so the extraction model sees both sides
  const officialTranscript = [assistantTranscript, callerLines].filter(Boolean).join('\n');

  // ── Persist the official transcript on the calls row — FALLBACK ONLY ─────────
  // This batch (Whisper) path is now a fallback. The client uses the live Realtime transcript as
  // the primary source of truth and only calls this route when no usable Realtime caller turns were
  // captured. As defense-in-depth, do NOT overwrite a transcript that already has caller content —
  // only write when the saved transcript is empty or a placeholder. We also never insert a
  // call_messages row here (saveCall() already wrote one row per Realtime turn).
  const existing = ((callRow.transcript as string | null) ?? '').trim();
  const existingIsPlaceholder =
    existing === '' ||
    existing.startsWith('(no transcript') ||
    !/^caller:/im.test(existing); // no caller lines yet → safe to fill from batch
  if (existingIsPlaceholder) {
    await supabase
      .from('calls')
      .update({ transcript: officialTranscript })
      .eq('id', callId);
  }

  return NextResponse.json({
    ok: true,
    transcript: existingIsPlaceholder ? officialTranscript : existing,
    callerTranscript: rawCallerText,
  });
}
