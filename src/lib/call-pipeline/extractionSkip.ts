// Pure descriptor for the "phone call SAVED, but extraction was SKIPPED because the app deployment
// has no OPENAI_API_KEY" outcome (used by src/app/api/twilio/post-call/route.ts).
//
// No runtime imports on purpose — the deterministic QA runner loads it directly. And because both
// builders take ONLY the two ids, the response body and the operator alert can never carry the
// caller transcript or personal details by construction (asserted in qa-units.ts).

export const EXTRACTION_SKIPPED_NO_API_KEY = 'extraction_skipped_no_api_key';

export interface ExtractionSkippedResponse {
  ok: true;
  saved: true;
  callId: string;
  extractionRan: false;
  reason: typeof EXTRACTION_SKIPPED_NO_API_KEY;
}

export interface ExtractionSkippedOpsAlert {
  component: 'twilio/post-call';
  event: typeof EXTRACTION_SKIPPED_NO_API_KEY;
  error: string;
  context: { businessId: string; callId: string };
}

/** Response returned when a phone call is saved but analysis was skipped (no app-side OPENAI key). */
export function extractionSkippedResponse(callId: string): ExtractionSkippedResponse {
  return { ok: true, saved: true, callId, extractionRan: false, reason: EXTRACTION_SKIPPED_NO_API_KEY };
}

/** Best-effort operator alert for the same case — carries only the two ids, never caller data. */
export function extractionSkippedOpsAlert(businessId: string, callId: string): ExtractionSkippedOpsAlert {
  return {
    component: 'twilio/post-call',
    event: EXTRACTION_SKIPPED_NO_API_KEY,
    error: 'OPENAI_API_KEY missing on the app deployment — phone call saved without analysis',
    context: { businessId, callId },
  };
}
