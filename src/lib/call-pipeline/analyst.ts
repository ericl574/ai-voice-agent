// Post-call Analyst — turns the raw extraction into the structured, staff-facing analysis the
// dashboard shows. PURE: only `import type` (no value imports), so it is trivially testable and
// loadable by the deterministic QA runner. All side effects (persistence) live in postCallCore.
//
// IMPORTANT: this produces a SUMMARY/analysis, never a rewritten transcript. The verbatim transcript
// stays in `calls.transcript` (buildTranscript); the analyst only reads the model's `summary` field
// and structured extraction — the two remain clearly separate.

import type { CallerIntent } from '../agents/routing/intents';
import type { ExtractionResult, CollectionAssessment } from './extraction';

export type BookingStatus = 'none' | 'incomplete' | 'captured';
export type Confidence = 'high' | 'medium' | 'low';

export interface AnalystResult {
  caller_name: string | null;
  caller_phone: string | null;
  intent: CallerIntent;
  requested_service: string | null;
  requested_time: string | null;
  booking_status: BookingStatus; // never 'confirmed' — staff confirm, not the agent
  staff_action_required: boolean;
  confidence: Confidence;
  risk_flags: string[];
  staff_summary: string; // short; NOT the transcript
}

export interface AnalystInputs {
  extraction: ExtractionResult;
  assessment: CollectionAssessment; // from assessCollection() — { collected, missingRequired, hasEnoughToAct }
  pastTime?: boolean; // injected: isPastAppointment() for any captured appointment (kept out of this pure module)
}

const STAFF_SUMMARY_MAX = 240;

// Map the coarse extraction intent to the specialist-routing CallerIntent taxonomy.
export function toCallerIntent(extractionIntent: string | null | undefined): CallerIntent {
  switch (extractionIntent) {
    case 'appointment_request':
    case 'service_request':
    case 'quote_request':
      return 'booking';
    case 'general_question':
      return 'faq';
    case 'complaint':
      return 'escalation';
    default:
      return 'general';
  }
}

export function buildAnalystResult({ extraction, assessment, pastTime = false }: AnalystInputs): AnalystResult {
  const intent = toCallerIntent(extraction.intent);
  const wantsRecord = !!(extraction.appointment?.should_create || extraction.service_request?.should_create);

  const booking_status: BookingStatus = !wantsRecord
    ? 'none'
    : assessment.hasEnoughToAct
      ? 'captured'
      : 'incomplete';

  const requested_service =
    extraction.appointment?.service?.trim() || extraction.service_request?.title?.trim() || null;
  const requested_time =
    [extraction.appointment?.requested_date, extraction.appointment?.requested_time]
      .filter(Boolean)
      .join(' ')
      .trim() || null;

  const urgent = extraction.service_request?.urgency === 'urgent';
  const unresolved = extraction.unresolved_question === true;
  const hasName = !!extraction.caller_name?.trim();
  const hasPhone = !!extraction.caller_phone?.trim();

  const risk_flags: string[] = [];
  if (pastTime) risk_flags.push('past_time');
  if (booking_status === 'incomplete') risk_flags.push('incomplete_booking');
  if (unresolved) risk_flags.push('unresolved_question');
  if (urgent) risk_flags.push('urgent');
  if (intent === 'escalation') risk_flags.push('complaint_or_escalation');
  if (booking_status !== 'none' && !hasPhone) risk_flags.push('no_callback_number');
  if (booking_status !== 'none' && !hasName) risk_flags.push('no_caller_name');

  // Staff must act whenever there is a captured request (they confirm it), an escalation/complaint,
  // an unanswered question, a past time, or an urgent flag.
  const staff_action_required =
    booking_status !== 'none' || intent === 'escalation' || unresolved || pastTime || urgent;

  let confidence: Confidence;
  if (intent === 'general' || extraction.intent === 'other' || extraction.intent == null) {
    confidence = wantsRecord ? 'medium' : 'low';
  } else if (booking_status === 'captured' || (intent === 'faq' && !unresolved)) {
    confidence = 'high';
  } else if (booking_status === 'incomplete' && assessment.missingRequired.length >= 2) {
    confidence = 'low';
  } else {
    confidence = 'medium';
  }

  const rawSummary = (extraction.summary || '').trim();
  const staff_summary =
    rawSummary.length > STAFF_SUMMARY_MAX
      ? rawSummary.slice(0, STAFF_SUMMARY_MAX - 1).trimEnd() + '…'
      : rawSummary || 'Call captured — see transcript.';

  return {
    caller_name: hasName ? extraction.caller_name!.trim() : null,
    caller_phone: hasPhone ? extraction.caller_phone!.trim() : null,
    intent,
    requested_service,
    requested_time,
    booking_status,
    staff_action_required,
    confidence,
    risk_flags,
    staff_summary,
  };
}
