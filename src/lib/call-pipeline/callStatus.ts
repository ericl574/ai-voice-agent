// Post-extraction dashboard status for a saved call. Shared by the browser and phone paths via
// runPostCallExtraction so both behave identically. Self-contained (no imports) so the deterministic
// QA runner can load it.
//
// A call is only 'resolved' when there is genuinely nothing for staff to do (a general question we
// answered, or a non-actionable / noise call). Anything with an actionable intent, or an actionable
// request that is missing core details, is 'pending' — surfaced as the dashboard's Follow-up state,
// never silently shown as "Resolved".

export type CallStatus = 'resolved' | 'pending';

export function deriveCallStatus(intent: string, missingRequiredCount: number): CallStatus {
  const actionable = intent !== 'general_question' && intent !== 'other';
  if (actionable || missingRequiredCount > 0) return 'pending';
  return 'resolved';
}
