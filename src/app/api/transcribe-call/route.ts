import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Transcribes caller mic audio using OpenAI Whisper, then assembles the official
// combined transcript (assistant lines + caller block) and persists it to the call record.
// This is the source of truth for post-call extraction — not browser SpeechRecognition.

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
    .select('id')
    .eq('id', callId)
    .eq('business_id', businessId)
    .single();
  if (!callRow) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // ── Transcribe caller audio with Whisper ─────────────────────────────────────

  const whisperForm = new FormData();
  whisperForm.append('file', audioFile, audioFile.name || 'caller-audio.webm');
  whisperForm.append('model', 'whisper-1');
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
    .map((l) => `Caller: ${l}`)
    .join('\n');

  // Place caller block after assistant lines so the extraction model sees both sides
  const officialTranscript = [assistantTranscript, callerLines].filter(Boolean).join('\n');

  // ── Persist official transcript + caller call_message ─────────────────────────

  await supabase
    .from('calls')
    .update({ transcript: officialTranscript })
    .eq('id', callId);

  if (rawCallerText) {
    // Insert caller turn as a single call_message with role 'customer'
    // (assistant messages were already inserted by saveCall in the client)
    await supabase.from('call_messages').insert({
      call_id: callId,
      role: 'customer',
      content: rawCallerText,
    });
  }

  return NextResponse.json({
    ok: true,
    transcript: officialTranscript,
    callerTranscript: rawCallerText,
  });
}
