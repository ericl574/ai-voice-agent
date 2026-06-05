import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  callerLinesOnly,
  applyKeywordFallbacks,
  looksLikePhone,
  type ExtractionResult,
} from '@/lib/call-pipeline/extraction';
import { todayInTimeZone, DEFAULT_BUSINESS_TIMEZONE } from '@/lib/call-pipeline/time';

// ── Extraction prompt ────────────────────────────────────────────────────────

function buildPrompt(today: string, timeZone: string): string {
  return `You are analyzing a phone call transcript from a service business. Today's date is ${today} in the business's local timezone (${timeZone}). Resolve ALL relative dates (today, tomorrow, Friday, next week) against this local date and timezone.

The transcript may be in any language (English, Chinese, mixed, etc.). You must reason semantically about the caller's intent — do not rely on explicit keywords.

Speaker labels:
- "Front desk:" = the AI front desk assistant
- "Caller:" = the human caller

Determine the caller's INTENT only from the CALLER's lines (the front desk lines give context but are not the source of intent).

CONTACT & APPOINTMENT DETAILS — caller_name, caller_phone, appointment.requested_date, appointment.requested_time:
- The front desk reads these details back to confirm them. The caller's own speech is transcribed by a lossy speech-to-text and may be garbled (e.g. a phone number heard as "7070 798 5201"), but the front desk's confirmation reflects what was actually understood.
- When the front desk explicitly confirms or reads back one of these details, use the FRONT-DESK-CONFIRMED value.
- Otherwise, fall back to the value the caller stated.
- Never invent a detail that was not stated or confirmed.

LANGUAGE RULES:
- summary and next_action: ALWAYS in English (business owner's dashboard language).
- Work with the transcript in its original language — do not translate it.

Return ONLY valid JSON — no explanation, no markdown fences:
{
  "summary": "concise 1-2 sentence summary in English: what the caller wanted + what staff must do",
  "intent": "appointment_request" | "service_request" | "quote_request" | "general_question" | "complaint" | "other",
  "caller_name": string | null,
  "caller_phone": string | null,
  "appointment": {
    "should_create": boolean,
    "requested_date": "YYYY-MM-DD" | null,
    "requested_time": "HH:MM" | null,
    "service": string | null,
    "notes": string | null
  } | null,
  "service_request": {
    "should_create": boolean,
    "title": string | null,
    "description": string | null,
    "urgency": "normal" | "urgent" | null
  } | null,
  "next_action": "one sentence in English on what staff should do next"
}

SEMANTIC INTENT RULES:

appointment.should_create — set true when the caller expresses any intent to visit, come in, or be seen at the business, even without explicit booking words. Examples across languages:
  English (implicit): "Can I come by tomorrow around five?", "Do you have time Friday afternoon?", "I need to see someone next week.", "Are you free Saturday?", "Can I stop by at 3?"
  Chinese (implicit): "我明天能过去吗？", "明天五点可以吗？", "帮我约一下明天五点。", "明天下午有空吗？"
  Explicit (any language): "I want an appointment", "预约", "réserver", "reservar"
  Rule: if the caller mentions visiting + a day/time, treat it as appointment_request. A pending appointment reviewed by staff is always better than a missed booking.

intent = appointment_request — use when appointment.should_create is true. Appointment intent wins over service_request when both time+visit signals exist. Do not classify an implicit visit request as general_question.

intent = general_question — use ONLY when the caller is asking a factual question with no visit/booking intent. Examples: "What time are you open?", "你们几点开门？", "Where are you located?"

intent = service_request — use only when the caller wants a callback, quote, repair, or follow-up with no appointment/visit intent.

Additional rules:
- Extract caller_name / caller_phone only if stated or confirmed (see CONTACT & APPOINTMENT DETAILS above)
- Set service_request.should_create=true only when the caller explicitly requests service/repair/callback AND appointment.should_create is false
- Convert relative dates (tomorrow/明天, Saturday, next week/下周) → YYYY-MM-DD; null if ambiguous
- Convert times → 24h HH:MM (e.g. 下午五点 → 17:00, "around five" → 17:00); null if ambiguous
- Do NOT invent data
- If transcript has no meaningful caller content: intent="other", summary="Test call — no substantive conversation recorded.", both should_create=false
- summary describes what ACTION staff must take, not just what was said`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  let body: { call_id?: string; business_id?: string; transcript?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { call_id, business_id, transcript } = body;
  if (!call_id || !business_id || typeof transcript !== 'string') {
    return NextResponse.json(
      { error: 'Missing required fields: call_id, business_id, transcript' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify call belongs to this user's business (RLS + explicit eq check)
  const { data: callRow } = await supabase
    .from('calls')
    .select('id')
    .eq('id', call_id)
    .eq('business_id', business_id)
    .single();

  if (!callRow) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // Resolve "today" in the BUSINESS's timezone so relative dates (tomorrow, Friday) land on the
  // correct local day — not the server/UTC day.
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', business_id)
    .single();
  const businessTimezone = (bizRow?.timezone as string) || DEFAULT_BUSINESS_TIMEZONE;
  const today = todayInTimeZone(businessTimezone);
  const transcriptText = transcript.trim() || '(no transcript captured)';
  const callerText = callerLinesOnly(transcriptText);

  // ── OpenAI extraction ─────────────────────────────────────────────────────

  let extraction: ExtractionResult;
  let extractionSource: 'openai' | 'fallback' = 'openai';

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildPrompt(today, businessTimezone) },
          { role: 'user', content: `Transcript:\n${transcriptText}` },
        ],
        max_tokens: 600,
        temperature: 0,
      }),
    });

    if (!oaiRes.ok) {
      const errText = await oaiRes.text();
      throw new Error(`OpenAI ${oaiRes.status}: ${errText}`);
    }

    const oaiData = await oaiRes.json();
    extraction = JSON.parse(oaiData.choices[0].message.content) as ExtractionResult;
  } catch (err: unknown) {
    // OpenAI call failed — use a safe empty extraction and let keyword fallback handle it
    const msg = err instanceof Error ? err.message : String(err);
    extractionSource = 'fallback';
    extraction = {
      summary: 'Call recorded — automatic analysis unavailable.',
      intent: 'other',
      caller_name: null,
      caller_phone: null,
      appointment: null,
      service_request: null,
      next_action: `Review call transcript manually. (Analysis error: ${msg})`,
    };
  }

  // ── Keyword fallback — override extraction when obvious signals missed ─────

  extraction = applyKeywordFallbacks(extraction, callerText, extractionSource);

  // ── Update call row ───────────────────────────────────────────────────────

  const callUpdate: Record<string, unknown> = {
    summary: extraction.summary,
    intent: extraction.intent,
    needs_staff_followup:
      extraction.intent !== 'general_question' && extraction.intent !== 'other',
  };
  if (extraction.caller_name) callUpdate.customer_name = extraction.caller_name;
  if (extraction.caller_phone) callUpdate.customer_phone = extraction.caller_phone;

  await supabase.from('calls').update(callUpdate).eq('id', call_id);

  // The per-turn caller transcription is lossy on digits; the front-desk confirmation (what the
  // model actually understood) is the accurate number. Overwrite the saved phone-number caller
  // turn(s) so Call History matches the confirmed value.
  if (extraction.caller_phone) {
    const { data: msgRows } = await supabase
      .from('call_messages')
      .select('id, content')
      .eq('call_id', call_id)
      .eq('role', 'customer');
    const phoneRowIds = (msgRows ?? [])
      .filter((m) => looksLikePhone((m.content as string) ?? ''))
      .map((m) => m.id);
    if (phoneRowIds.length > 0) {
      await supabase
        .from('call_messages')
        .update({ content: extraction.caller_phone })
        .in('id', phoneRowIds);
    }
  }

  // ── Duplicate prevention: check existing linked records ───────────────────

  const [{ data: existingAppt }, { data: existingSR }] = await Promise.all([
    supabase.from('appointments').select('id').eq('call_id', call_id).maybeSingle(),
    supabase.from('service_requests').select('id').eq('call_id', call_id).maybeSingle(),
  ]);

  let appointmentCreated = false;
  let serviceRequestCreated = false;
  let appointmentError: string | null = null;
  let serviceRequestError: string | null = null;

  // ── Create appointment ────────────────────────────────────────────────────

  if (extraction.appointment?.should_create && !existingAppt) {
    const { error: apptErr } = await supabase.from('appointments').insert({
      business_id,
      call_id,
      customer_name: extraction.caller_name ?? null,
      customer_phone: extraction.caller_phone ?? null,
      appointment_date: extraction.appointment.requested_date ?? null,
      appointment_time: extraction.appointment.requested_time ?? null,
      service_type: extraction.appointment.service ?? 'Appointment request',
      special_request: extraction.appointment.notes ?? null,
      status: 'pending',
      staff_notes: `Auto-created from call transcript. ${extraction.next_action}`,
    });
    if (!apptErr) {
      appointmentCreated = true;
    } else {
      appointmentError = apptErr.message;
    }
  }

  // ── Create service request ────────────────────────────────────────────────
  // Skip if an appointment was already created for this call.

  const needsSR =
    extraction.service_request?.should_create && !existingSR && !appointmentCreated;

  if (needsSR) {
    const urgentTag = extraction.service_request?.urgency === 'urgent' ? ' [URGENT]' : '';
    const { error: srErr } = await supabase.from('service_requests').insert({
      business_id,
      call_id,
      customer_name: extraction.caller_name ?? null,
      customer_phone: extraction.caller_phone ?? null,
      request_type: extraction.service_request!.title ?? extraction.intent,
      request_details: extraction.service_request!.description ?? null,
      preferred_time: null,
      status: 'pending',
      staff_notes: `Auto-created from call transcript.${urgentTag} ${extraction.next_action}`,
    });
    if (!srErr) {
      serviceRequestCreated = true;
    } else {
      serviceRequestError = srErr.message;
    }
  }

  return NextResponse.json({
    ok: true,
    extraction,
    appointmentCreated,
    serviceRequestCreated,
    ...(appointmentError && { appointmentError }),
    ...(serviceRequestError && { serviceRequestError }),
  });
}
