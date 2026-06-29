// Deterministic: should this call be flagged for staff follow-up (calls.needs_staff_followup)?
//
// No imports — loadable by the Node QA runner.
//
// Rule:
//   • Actionable intents (appointment_request, service_request, quote_request, complaint, …) always
//     need follow-up.
//   • A plain answered question or a no-content "other" call does NOT — EXCEPT when the caller asked
//     something the front desk could not answer (an unresolved question), which must reach staff as
//     an open item even though its intent is general_question / other.

export function deriveNeedsStaffFollowup(intent: string, unresolvedQuestion: boolean): boolean {
  if (intent !== 'general_question' && intent !== 'other') return true;
  return unresolvedQuestion === true;
}
