import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface ExtractionResult {
  summary: string;
  intent: string;
  caller_name: string | null;
  caller_phone: string | null;
  appointment: {
    should_create: boolean;
    requested_date: string | null;
    requested_time: string | null;
    service: string | null;
    notes: string | null;
  } | null;
  service_request: {
    should_create: boolean;
    title: string | null;
    description: string | null;
    urgency: 'normal' | 'urgent' | null;
  } | null;
  next_action: string;
}

// ── Extraction prompt ────────────────────────────────────────────────────────

function buildPrompt(today: string): string {
  return `You are analyzing a phone call transcript from a service business. Today's date is ${today}.

The transcript uses these speaker labels:
- "Front desk:" = what the AI front desk assistant said
- "Caller:" = what the human caller said

IMPORTANT: Extract intent and requests ONLY from the CALLER's lines. The front desk lines provide context but are not the source of the caller's request.

Return ONLY valid JSON — no explanation, no markdown fences — matching this exact schema:
{
  "summary": "concise 1-2 sentence summary: what the caller wanted + what staff must do",
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
  "next_action": "one sentence on what staff should do next"
}

Rules:
- Extract caller_name / caller_phone ONLY if the caller explicitly said them
- Set appointment.should_create=true any time the caller asked to book, schedule, reserve, or come in for an appointment — when in doubt, create it; a pending request reviewed by staff is always better than a missed booking
- Set service_request.should_create=true if the caller asked for service, repair, quote, estimate, follow-up, or help — but NOT when an appointment is already being created (don't create both for the same call)
- Convert relative dates (tomorrow, Saturday, next week) to YYYY-MM-DD using today's date; null if genuinely ambiguous
- Convert times to 24h HH:MM; null if ambiguous
- Do NOT invent data not stated by the caller
- If transcript has no meaningful caller content: intent="other", summary="Test call — no substantive conversation recorded.", both should_create=false
- summary tells staff what ACTION to take, not just what was said`;
}

// ── Deterministic keyword fallbacks ──────────────────────────────────────────
// Applied when OpenAI extraction misses an obvious request. Checks the full
// transcript text regardless of role labels, so even a partially polluted
// transcript triggers the correct record creation.

function hasAppointmentKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  const apptWord = /\b(appointment|book(?:ing)?|schedule|reserve|reservation|come in|slot|available)\b/.test(lower);
  const timeRef = /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d+\s*(?:am|pm|o'clock)|at\s+\d+)\b/.test(lower);
  return apptWord && timeRef;
}

function hasServiceKeywords(text: string): boolean {
  return /\b(service|repair|fix(?:ing)?|help|quote|estimate|issue|problem|call\s*back|callback|follow.?up|complaint|need someone)\b/i.test(text);
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

  const today = new Date().toISOString().split('T')[0];
  const transcriptText = transcript.trim() || '(no transcript captured)';

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
          { role: 'system', content: buildPrompt(today) },
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

  if (!extraction.appointment?.should_create && hasAppointmentKeywords(transcriptText)) {
    if (!extraction.appointment) {
      extraction.appointment = {
        should_create: true,
        requested_date: null,
        requested_time: null,
        service: null,
        notes: null,
      };
    } else {
      extraction.appointment.should_create = true;
    }
    if (extraction.intent === 'other' || extraction.intent === 'general_question') {
      extraction.intent = 'appointment_request';
    }
    if (extractionSource === 'fallback') {
      extraction.summary = 'Caller requested an appointment. Staff must confirm date, time, and availability.';
      extraction.next_action = 'Contact caller to confirm appointment details.';
    }
  }

  // Only consider service request fallback when no appointment is being created
  if (
    !extraction.appointment?.should_create &&
    !extraction.service_request?.should_create &&
    hasServiceKeywords(transcriptText)
  ) {
    if (!extraction.service_request) {
      extraction.service_request = {
        should_create: true,
        title: 'Service inquiry',
        description: null,
        urgency: 'normal',
      };
    } else {
      extraction.service_request.should_create = true;
    }
    if (extraction.intent === 'other') {
      extraction.intent = 'service_request';
    }
  }

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
