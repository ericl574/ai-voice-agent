// Pure per-call quality metric — turns one finished call into machine-readable concerns and a
// should-page decision, so call reliability is observable in production (not just dev).
//
// No imports on purpose so BOTH the standalone phone bridge (relative .ts import, run via
// `node --experimental-strip-types`) and the app post-call route can share one definition, and the
// deterministic QA runner can load it. All logging / alerting side effects live in the callers.

export interface CallQualityInput {
  endReason: string;
  callerTurns: number;
  assistantTurns: number;
  usedFallbackInstructions: boolean;
  durationSec: number;
  extraction?: 'ran' | 'skipped';
}

export interface CallQualityMetric {
  endReason: string;
  callerTurns: number;
  assistantTurns: number;
  durationSec: number;
  usedFallbackInstructions: boolean;
  extraction: 'ran' | 'skipped' | 'unknown';
  concerns: string[]; // machine-readable flags for logs/alerts
  shouldAlert: boolean; // true only for SERIOUS signals worth paging ops
}

// The clean, expected ways a call ends (browser + phone reasons). Anything else is treated as an
// abnormal/error end (socket error, OpenAI drop, peer disconnect, connect timeout, …).
const CLEAN_END_REASONS = new Set([
  'twilio stop',
  'end-cue',
  'idle-timeout',
  'max-duration',
  'manual',
  'auto-end',
  'inactivity',
]);

export function buildCallQualityMetric(input: CallQualityInput): CallQualityMetric {
  const concerns: string[] = [];
  if (input.usedFallbackInstructions) concerns.push('fallback_instructions');
  if (input.assistantTurns === 0) concerns.push('no_assistant_turns');
  if (input.callerTurns === 0) concerns.push('no_caller_turns');
  // Abnormal end = a reported reason that is not one of the clean ones. An absent/'unknown' reason
  // (older bridge that doesn't report it) is NOT abnormal — absence of signal must never page ops.
  const abnormalEnd =
    input.endReason.length > 0 &&
    input.endReason !== 'unknown' &&
    !CLEAN_END_REASONS.has(input.endReason);
  if (abnormalEnd) concerns.push('abnormal_end');
  if (input.extraction === 'skipped') concerns.push('extraction_skipped');

  // Page ops only on signals that mean a REAL caller likely had a broken experience: the generic
  // fallback prompt was used (no business identity/KB), the assistant never spoke, or the call ended
  // abnormally. A lone 0-caller-turn call (hangup / wrong number) is too noisy to page, and a skipped
  // extraction already has its own dedicated alert — both are noted as concerns but do not page.
  const shouldAlert = input.usedFallbackInstructions || input.assistantTurns === 0 || abnormalEnd;

  return {
    endReason: input.endReason,
    callerTurns: input.callerTurns,
    assistantTurns: input.assistantTurns,
    durationSec: input.durationSec,
    usedFallbackInstructions: input.usedFallbackInstructions,
    extraction: input.extraction ?? 'unknown',
    concerns,
    shouldAlert,
  };
}
