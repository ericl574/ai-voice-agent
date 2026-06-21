// Post-call extraction + record creation — the SHARED core behind both entry points:
//   • /api/post-call         (browser test calls; authenticated user session client)
//   • /api/twilio/post-call  (real phone calls saved by the bridge; service-role client)
// Behavior is identical regardless of caller: OpenAI semantic extraction (with retry + keyword
// fallback), completeness check, calls-row update, phone-turn correction, duplicate-safe
// appointment / service-request creation, and the stubbed reservation-confirmation SMS.
//
// The Supabase client passed in determines scope: the authed route's client is RLS-scoped; the
// Twilio route passes the service-role client with a server-resolved business_id (never
// client-trusted). This module performs NO auth — entry routes must authorize first.

import {
  callerLinesOnly,
  applyKeywordFallbacks,
  assessCollection,
  looksLikePhone,
  type ExtractionResult,
} from './extraction';
import { getVertical } from '@/lib/agents/verticals/registry';
import { deriveCallStatus } from './callStatus';
import { todayInTimeZone, DEFAULT_BUSINESS_TIMEZONE } from './time';
import type { AgentConfig } from '@/lib/supabase/businesses';
import { sendReservationSms, reservationConfirmUrl } from '@/lib/sms/sendReservationSms';
import { deliverCallNotifications } from '@/lib/notify/callDelivery';
import { randomUUID } from 'crypto';

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

// ── Core runner ───────────────────────────────────────────────────────────────

export interface PostCallBizRow {
  timezone?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  business_type?: string | null;
  agent_config?: AgentConfig | null;
}

export interface PostCallResult {
  extraction: ExtractionResult;
  appointmentCreated: boolean;
  serviceRequestCreated: boolean;
  appointmentError: string | null;
  serviceRequestError: string | null;
}

export async function runPostCallExtraction(opts: {
  // Accepts both the RLS-scoped session client and the server service-role client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  apiKey: string;
  callId: string;
  businessId: string;
  transcript: string;
  bizRow: PostCallBizRow | null;
  /** Absolute origin used to build the reservation confirm link (auto-confirm mode). */
  origin: string;
  /** Call channel — used only for delivery wording. Defaults to 'web' (browser test call). */
  source?: 'web' | 'phone';
}): Promise<PostCallResult> {
  const { supabase, apiKey, callId, businessId, bizRow, origin } = opts;

  const businessTimezone = (bizRow?.timezone as string) || DEFAULT_BUSINESS_TIMEZONE;
  const today = todayInTimeZone(businessTimezone);
  const transcriptText = opts.transcript.trim() || '(no transcript captured)';
  const callerText = callerLinesOnly(transcriptText);

  // ── OpenAI extraction ─────────────────────────────────────────────────────

  let extraction: ExtractionResult;
  let extractionSource: 'openai' | 'fallback' = 'openai';

  // One extraction attempt, bounded by a 30s timeout. A transient failure (timeout, 429, or 5xx)
  // is retried once before falling back — so a one-off API hiccup doesn't silently drop a booking.
  const extractOnce = async (): Promise<ExtractionResult> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
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
        signal: ctrl.signal,
      });
      if (!oaiRes.ok) {
        const errText = await oaiRes.text();
        const e = new Error(`OpenAI ${oaiRes.status}: ${errText}`) as Error & { status?: number };
        e.status = oaiRes.status;
        throw e;
      }
      const oaiData = await oaiRes.json();
      return JSON.parse(oaiData.choices[0].message.content) as ExtractionResult;
    } finally {
      clearTimeout(t);
    }
  };

  if (!callerText.trim()) {
    // No caller speech was captured (silent/garbled mic, empty recording). Do NOT ask the model to
    // infer intent from the assistant-only lines — it would hallucinate an appointment or a false
    // "no conversation" summary. Save a safe, no-action result instead.
    extractionSource = 'fallback';
    extraction = {
      summary: 'No caller speech was captured on this call.',
      intent: 'other',
      caller_name: null,
      caller_phone: null,
      appointment: null,
      service_request: null,
      next_action: 'No caller audio was understood — review the recording manually.',
    };
  } else try {
    try {
      extraction = await extractOnce();
    } catch (err1: unknown) {
      // Retry once on transient errors (timeout/abort → no status; 429; 5xx). Don't retry 4xx.
      const status = (err1 as { status?: number }).status;
      const transient = status === undefined || status === 429 || status >= 500;
      if (!transient) throw err1;
      console.warn('[FD] extraction transient failure — retrying once:', err1 instanceof Error ? err1.message : err1);
      await new Promise((r) => setTimeout(r, 600));
      extraction = await extractOnce();
    }
  } catch (err: unknown) {
    // OpenAI call failed — use a safe empty extraction and let keyword fallback handle it.
    // The provider error detail stays in server logs; staff-facing notes get a clean message.
    console.error('[FD] post-call extraction failed:', err instanceof Error ? err.message : err);
    extractionSource = 'fallback';
    extraction = {
      summary: 'Call recorded — automatic analysis unavailable.',
      intent: 'other',
      caller_name: null,
      caller_phone: null,
      appointment: null,
      service_request: null,
      next_action: 'Automatic analysis was unavailable — review the transcript manually.',
    };
  }

  // ── Keyword fallback — override extraction when obvious signals missed ─────

  extraction = applyKeywordFallbacks(extraction, callerText, extractionSource);

  // ── Completeness check (deterministic) ────────────────────────────────────
  // For an actionable request, flag which CORE required details the call didn't capture, so staff
  // know what to follow up on. Additive only — appended to next_action (which flows into the
  // appointment / service-request staff_notes). Does not change intent, record creation, status, or
  // needs_staff_followup. Phone is intentionally not a required field on any vertical.
  const isActionable =
    !!extraction.appointment?.should_create || !!extraction.service_request?.should_create;
  let missingRequiredCount = 0;
  if (isActionable) {
    const vertical = getVertical((bizRow?.business_type as string) ?? null);
    const { missingRequired } = assessCollection(extraction, vertical.requiredFields);
    missingRequiredCount = missingRequired.length;
    if (missingRequired.length > 0) {
      extraction.next_action =
        `${extraction.next_action} Missing from call: ${missingRequired.join(', ')}.`.trim();
    }
  }

  // ── Update call row ───────────────────────────────────────────────────────
  // `status` is set from the outcome (deriveCallStatus): actionable or incomplete → 'pending'
  // (the dashboard's Follow-up state); only a truly handled call stays 'resolved'. This replaces the
  // hardcoded 'resolved' the insert paths use, so a confused/incomplete call is never shown Resolved.

  const callUpdate: Record<string, unknown> = {
    summary: extraction.summary,
    intent: extraction.intent,
    status: deriveCallStatus(extraction.intent, missingRequiredCount),
    needs_staff_followup:
      extraction.intent !== 'general_question' && extraction.intent !== 'other',
  };
  if (extraction.caller_name) callUpdate.customer_name = extraction.caller_name;
  if (extraction.caller_phone) callUpdate.customer_phone = extraction.caller_phone;

  const { error: updErr } = await supabase.from('calls').update(callUpdate).eq('id', callId);
  if (updErr) console.error('[FD] post-call: calls row update failed:', updErr.message);

  // next_action powers the digest's "suggested follow-up". Best-effort, separate from the main
  // update so a missing column (call_digests migration not yet run) can't break the write above.
  const { error: naErr } = await supabase
    .from('calls')
    .update({ next_action: extraction.next_action })
    .eq('id', callId);
  if (naErr) console.warn('[FD] could not save next_action (run the call_digests migration):', naErr.message);

  // The per-turn caller transcription is lossy on digits; the front-desk confirmation (what the
  // model actually understood) is the accurate number. Overwrite the saved phone-number caller
  // turn(s) so Call History matches the confirmed value.
  if (extraction.caller_phone) {
    const { data: msgRows } = await supabase
      .from('call_messages')
      .select('id, content')
      .eq('call_id', callId)
      .eq('role', 'customer');
    const phoneRowIds = ((msgRows ?? []) as Array<{ id: string; content: string | null }>)
      .filter((m) => looksLikePhone(m.content ?? ''))
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
    supabase.from('appointments').select('id').eq('call_id', callId).maybeSingle(),
    supabase.from('service_requests').select('id').eq('call_id', callId).maybeSingle(),
  ]);

  let appointmentCreated = false;
  let serviceRequestCreated = false;
  let appointmentError: string | null = null;
  let serviceRequestError: string | null = null;

  // ── Create appointment ────────────────────────────────────────────────────

  if (extraction.appointment?.should_create && !existingAppt) {
    const agentConfig = (bizRow?.agent_config as AgentConfig | null) ?? null;
    const callerPhone = extraction.caller_phone ?? null;
    // Auto mode: take the reservation but require the caller to confirm via an SMS card link.
    // Needs a phone to text — without one we fall back to the staff-confirm (pending) flow.
    const autoConfirm =
      agentConfig?.reservation_confirmation_mode === 'auto' && !!callerPhone;
    const windowHours = agentConfig?.confirmation_window_hours ?? 24;

    const token = autoConfirm ? randomUUID() : null;
    const expiresAt = autoConfirm
      ? new Date(Date.now() + windowHours * 3600_000).toISOString()
      : null;

    const { error: apptErr } = await supabase.from('appointments').insert({
      business_id: businessId,
      call_id: callId,
      customer_name: extraction.caller_name ?? null,
      customer_phone: callerPhone,
      appointment_date: extraction.appointment.requested_date ?? null,
      appointment_time: extraction.appointment.requested_time ?? null,
      service_type: extraction.appointment.service ?? 'Appointment request',
      special_request: extraction.appointment.notes ?? null,
      status: autoConfirm ? 'awaiting_customer' : 'pending',
      staff_notes: autoConfirm
        ? `Auto-created from call transcript. Awaiting customer card confirmation. ${extraction.next_action}`
        : `Auto-created from call transcript. ${extraction.next_action}`,
      ...(autoConfirm ? { confirmation_token: token, expires_at: expiresAt } : {}),
    });
    if (!apptErr) {
      appointmentCreated = true;
      // Fire the (stubbed) confirmation SMS. Never blocks or fails the pipeline.
      if (autoConfirm && token) {
        try {
          await sendReservationSms({
            toPhone: callerPhone,
            businessName: (bizRow?.name as string) || 'Our team',
            businessPhone: (bizRow?.phone as string) ?? null,
            customerName: extraction.caller_name ?? null,
            date: extraction.appointment.requested_date ?? null,
            time: extraction.appointment.requested_time ?? null,
            windowHours,
            confirmUrl: reservationConfirmUrl(origin, token),
          });
        } catch (smsErr) {
          console.warn('[FD] reservation SMS stub failed (non-fatal):', smsErr);
        }
      }
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
      business_id: businessId,
      call_id: callId,
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

  // ── Call Delivery ─────────────────────────────────────────────────────────
  // MVP default is the DAILY AFTER-HOURS DIGEST (sent later by /api/cron/digest), so per-call
  // SMS/email is OFF unless the business explicitly opted into an instant mode. The per-call code
  // is kept for that optional mode. Runs AFTER the save, demo never reaches here, never throws up.
  const deliveryMode = (bizRow?.agent_config as AgentConfig | null)?.delivery_mode ?? 'daily_digest';
  if (deliveryMode === 'instant_all' || deliveryMode === 'instant_action_needed') {
    try {
      await deliverCallNotifications({
        business: {
          name: bizRow?.name ?? null,
          phone: bizRow?.phone ?? null,
          email: bizRow?.email ?? null,
          agentConfig: (bizRow?.agent_config as AgentConfig | null) ?? null,
        },
        source: opts.source ?? 'web',
        extraction,
      });
    } catch (err) {
      console.error('[FD] call delivery failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  return { extraction, appointmentCreated, serviceRequestCreated, appointmentError, serviceRequestError };
}
