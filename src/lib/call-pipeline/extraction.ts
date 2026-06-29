// Pure call-pipeline extraction logic.
// No browser, no Supabase, no OpenAI — safe to import in tests and server routes.
//
// ARCHITECTURE:
//   PRIMARY   → semantic extraction by the model in /api/post-call.
//               The model handles all languages, implicit intent, and context.
//               This is the right tool for intent detection.
//   FALLBACK  → the keyword guardrails below. They are a safety net only — triggered when the
//               model clearly misses an unambiguous explicit signal (e.g. model returns
//               "service_request" for a call that contained the word "appointment").
//               Do NOT turn this into a comprehensive NLU system. Only add a keyword when:
//               (1) it is unambiguous in context, (2) it covers a real AI failure mode,
//               (3) false-positive risk is very low.

export interface ExtractionResult {
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
  // True when the caller asked something the front desk could NOT answer from the business info /
  // knowledge base (an open question staff must address). Optional: absent/undefined ⇒ treated as
  // false. Lets a general question the agent couldn't answer still be flagged for staff follow-up.
  unresolved_question?: boolean;
}

// Result of checking how complete an actionable request is, against a vertical's required fields.
export interface CollectionAssessment {
  collected: string[];
  missingRequired: string[];
  hasEnoughToAct: boolean;
}

// Deterministic completeness check over the CORE fields extraction already captures
// (name, phone, date, time, service). Post-call uses it to tell staff what is still MISSING on an
// actionable request (appointment / service request). Coarse by design: richer vertical details
// (party size, address, reason for visit) live in notes/description and are not assessed here.
// `requiredFields` is INJECTED (the vertical's schema) so this module stays self-contained for the
// Node QA runner — never import the vertical profiles here. 'phone' is treated like any other field;
// keep it OUT of a vertical's requiredFields if phone should not block (product rule: it shouldn't).
export function assessCollection(
  extraction: ExtractionResult,
  requiredFields: readonly string[],
): CollectionAssessment {
  const present: Record<string, boolean> = {
    name: !!extraction.caller_name?.trim(),
    phone: !!extraction.caller_phone?.trim(),
    date: !!extraction.appointment?.requested_date,
    time: !!extraction.appointment?.requested_time,
    service:
      !!extraction.appointment?.service?.trim() ||
      !!extraction.service_request?.title?.trim(),
  };
  const required = Array.from(new Set(requiredFields));
  const collected = required.filter((f) => present[f]);
  const missingRequired = required.filter((f) => !present[f]);
  return { collected, missingRequired, hasEnoughToAct: missingRequired.length === 0 };
}

// True when a caller turn is predominantly a phone number (≥7 digits, mostly digits).
// Used to locate the caller turn whose lossy transcription should be replaced with the
// phone number the Front Desk confirmed. Time/date turns ("8 PM", "tomorrow at 5") have
// too few digits to match.
export function looksLikePhone(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (compact.length === 0) return false;
  const digits = compact.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return digits.length / compact.length > 0.5;
}

// Isolates caller lines from an assembled transcript. The `Caller:` prefix is the canonical
// CALLER_LABEL owned by src/lib/call-pipeline/transcript.ts; it is duplicated here as a literal
// only because this module is loaded by the Node QA runner (which can't resolve the cross-file
// import). A contract test in qa:call-pipeline asserts buildTranscript() <-> callerLinesOnly() stay
// in sync — update both together.
export function callerLinesOnly(transcript: string): string {
  return transcript
    .split('\n')
    .filter((line) => /^Caller:/i.test(line.trim()))
    .map((line) => line.replace(/^Caller:\s*/i, ''))
    .join(' ');
}

// GUARDRAIL: explicit booking-intent words the model might miss when overloaded or hallucinating.
// This is NOT the primary detection layer — semantic extraction by the model comes first.
// "come by" / "stop by" are included because they unambiguously mean a visit in business context.
export function hasAppointmentKeywords(callerText: string): boolean {
  const enMatch = /\b(appointment|book(?:ing)?|schedule|reserve|reservation|come in|come by|stop by|slot|available)\b/i.test(callerText);
  // Chinese: 预约/预订/预定 (appointment/reservation), 来一下 (come in a moment)
  const zhMatch = /预约|预订|预定|来一下/.test(callerText);
  return enMatch || zhMatch;
}

// GUARDRAIL: explicit service/follow-up signals the model might miss.
export function hasServiceKeywords(callerText: string): boolean {
  const enMatch = /\b(service|repair|fix(?:ing)?|help|quote|estimate|issue|problem|call\s*back|callback|follow.?up|complaint|need someone)\b/i.test(callerText);
  // Chinese: 维修/修理 (repair), 报价 (quote), 投诉 (complaint), 回电 (callback)
  const zhMatch = /维修|修理|报价|投诉|回电/.test(callerText);
  return enMatch || zhMatch;
}

// Applies deterministic keyword GUARDRAILS on top of a model extraction result.
// This is the FALLBACK layer — it corrects clear model misclassifications using explicit signals.
// It must NOT replace semantic reasoning. Only checks caller lines (pre-filtered by callerLinesOnly).
// When extractionSource='fallback' (no model available), also rewrites summary/next_action.
export function applyKeywordFallbacks(
  extraction: ExtractionResult,
  callerText: string,
  extractionSource: 'openai' | 'fallback' = 'openai',
): ExtractionResult {
  const result: ExtractionResult = {
    ...extraction,
    appointment: extraction.appointment ? { ...extraction.appointment } : null,
    service_request: extraction.service_request ? { ...extraction.service_request } : null,
  };

  if (!result.appointment?.should_create && hasAppointmentKeywords(callerText)) {
    if (!result.appointment) {
      result.appointment = {
        should_create: true,
        requested_date: null,
        requested_time: null,
        service: null,
        notes: null,
      };
    } else {
      result.appointment.should_create = true;
    }
    // Keyword confirms appointment — always override intent, even if AI said service_request
    result.intent = 'appointment_request';
    // Clear any AI-set service_request that conflicts with the confirmed appointment
    if (result.service_request?.should_create) {
      result.service_request = { ...result.service_request, should_create: false };
    }
    if (extractionSource === 'fallback') {
      result.summary = 'Caller requested an appointment. Staff must confirm date, time, and availability.';
      result.next_action = 'Contact caller to confirm appointment details.';
    }
  }

  // Only consider service request when no appointment is being created
  if (
    !result.appointment?.should_create &&
    !result.service_request?.should_create &&
    hasServiceKeywords(callerText)
  ) {
    if (!result.service_request) {
      result.service_request = {
        should_create: true,
        title: 'Service inquiry',
        description: null,
        urgency: 'normal',
      };
    } else {
      result.service_request.should_create = true;
    }
    if (result.intent === 'other') {
      result.intent = 'service_request';
    }
  }

  return result;
}
