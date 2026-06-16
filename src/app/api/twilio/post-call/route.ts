import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildTranscript } from '@/lib/call-pipeline/transcript';
import { looksLikeNoiseOrEmpty } from '@/lib/call-pipeline/noise';
import { runPostCallExtraction } from '@/lib/call-pipeline/postCallCore';
import { SITE_URL } from '@/lib/site';

// Bridge-only endpoint: saves a finished PHONE call into the normal dashboard flow (calls +
// call_messages) and runs the SAME post-call extraction core as browser calls. Guarded by the
// shared TWILIO_BRIDGE_SECRET. The business_id was server-pinned by /api/twilio/voice (env
// TWILIO_BUSINESS_ID) — demo-fallback phone calls have no business and are not saved.

export const runtime = 'nodejs';

interface PhoneTurn {
  role: 'assistant' | 'caller';
  text: string;
}

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

  let body: {
    businessId?: string | null;
    fromNumber?: string | null;
    startedAt?: string;
    endedAt?: string;
    turns?: PhoneTurn[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const turns = (body.turns ?? []).filter(
    (t): t is PhoneTurn =>
      !!t && (t.role === 'assistant' || t.role === 'caller') && typeof t.text === 'string',
  );

  if (!body.businessId) {
    // Demo-fallback line (no TWILIO_BUSINESS_ID configured): nothing to save, by design.
    return NextResponse.json({ ok: true, saved: false, reason: 'no_business' });
  }
  if (turns.length === 0) {
    return NextResponse.json({ ok: true, saved: false, reason: 'no_turns' });
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error('[FD] twilio/post-call: SUPABASE_SERVICE_ROLE_KEY missing — phone call NOT saved');
    return NextResponse.json({ error: 'Server storage not configured' }, { status: 503 });
  }

  // Same transcript source of truth as browser calls (buildTranscript + noise filter).
  const transcriptText = buildTranscript(
    turns.map((t) => ({ role: t.role === 'assistant' ? 'assistant' as const : 'user' as const, text: t.text })),
    looksLikeNoiseOrEmpty,
  );

  const started = body.startedAt ? new Date(body.startedAt) : new Date();
  const ended = body.endedAt ? new Date(body.endedAt) : new Date();
  const durationSeconds = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));

  const baseRow: Record<string, unknown> = {
    business_id: body.businessId,
    customer_name: 'Phone call',
    customer_phone: body.fromNumber ?? null,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    duration_seconds: durationSeconds,
    status: 'resolved',
    intent: 'other',
    summary: 'Phone call recorded — analysis pending.',
    transcript: transcriptText,
    needs_staff_followup: false,
  };

  // Prefer marking the source; the `source` column is an optional additive migration
  // (supabase/migrations/20260611000001_calls_source.sql) — retry without it when absent.
  let callId: string | null = null;
  let insertError: string | null = null;
  {
    const { data, error } = await admin
      .from('calls')
      .insert({ ...baseRow, source: 'phone' })
      .select('id')
      .single();
    if (!error && data) {
      callId = data.id as string;
    } else {
      const { data: data2, error: error2 } = await admin
        .from('calls')
        .insert(baseRow)
        .select('id')
        .single();
      if (!error2 && data2) callId = data2.id as string;
      else insertError = error2?.message ?? error?.message ?? 'unknown insert error';
    }
  }

  if (!callId) {
    console.error('[FD] twilio/post-call: call insert failed:', insertError);
    return NextResponse.json({ error: 'Could not save call' }, { status: 500 });
  }

  // Per-turn rows for Call History (same filtering rules as the browser save path).
  const turnRows = turns
    .filter((t) => t.text.trim().length > 0 && (t.role === 'assistant' || !looksLikeNoiseOrEmpty(t.text)))
    .map((t) => ({
      call_id: callId,
      role: t.role === 'assistant' ? 'assistant' : 'customer',
      content: t.text,
    }));
  if (turnRows.length > 0) {
    const { error: msgError } = await admin.from('call_messages').insert(turnRows);
    if (msgError) console.warn('[FD] twilio/post-call: transcript rows failed:', msgError.message);
  }

  // Same extraction core as browser calls — appointments/service requests land in the dashboard.
  const apiKey = process.env.OPENAI_API_KEY;
  let extractionRan = false;
  if (apiKey) {
    try {
      const { data: bizRow } = await admin
        .from('businesses')
        .select('timezone, name, phone, email, business_type, agent_config')
        .eq('id', body.businessId)
        .single();
      await runPostCallExtraction({
        supabase: admin,
        apiKey,
        callId,
        businessId: body.businessId,
        transcript: transcriptText,
        bizRow: bizRow ?? null,
        origin: SITE_URL,
        source: 'phone',
      });
      extractionRan = true;
    } catch (err) {
      console.error('[FD] twilio/post-call extraction failed:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, saved: true, callId, extractionRan });
}
