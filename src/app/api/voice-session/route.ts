import { NextResponse } from 'next/server';

const MODEL = 'gpt-realtime-mini';

const SYSTEM_INSTRUCTIONS = `You are a professional AI front desk agent for a service business. Your job is to:
- Greet callers warmly and ask how you can help
- Answer general questions about the business (hours, services, location)
- Collect appointment or service request information: caller's name, phone number, service needed, and preferred date/time
- Always be concise and polite
- NEVER confirm bookings yourself — always say that staff will follow up to confirm
- If a caller is upset or the issue is complex, offer to have a staff member call them back

When taking down an appointment request, confirm back the key details (name, service, date/time) and remind the caller it is pending staff confirmation.`;

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

  try {
    // GA endpoint: POST /v1/realtime/client_secrets
    // The session config is nested under "session"; the response top-level "value" is the ephemeral token.
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
          audio: {
            output: { voice: 'alloy' },
          },
          instructions: SYSTEM_INSTRUCTIONS,
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: { type: 'server_vad' },
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
    // GA response: { value: "ek_...", expires_at: ..., ... }
    return NextResponse.json({
      clientSecret: data.value,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
