// Pure call-health classification for the operator ops view. Turns a saved call row into a
// failure/low-quality verdict so a concierge pilot operator can spot bad calls fast. No imports →
// testable + loadable by the deterministic QA runner. All I/O lives in /api/ops/calls.

export interface CallHealthRow {
  status?: string | null;
  summary?: string | null;
  needs_staff_followup?: boolean | null;
  // Optional post-call analyst output (present once the calls_analysis migration is applied).
  analysis?: {
    confidence?: string | null;
    risk_flags?: string[] | null;
    staff_action_required?: boolean | null;
  } | null;
}

export interface CallHealth {
  problem: boolean; // a QUALITY/FAILURE signal — worth an operator's attention
  reasons: string[];
  needs_followup: boolean; // captured request awaiting staff (normal, not a failure)
}

// Summary phrases the save path writes when capture/analysis degraded (postCallCore.ts).
const FAILURE_SUMMARY = /analysis pending|analysis unavailable|no caller speech|no substantive/i;

export function classifyCallHealth(row: CallHealthRow): CallHealth {
  const reasons: string[] = [];
  if (FAILURE_SUMMARY.test(row.summary || '')) reasons.push('capture_or_analysis_failed');
  if (row.analysis?.confidence === 'low') reasons.push('low_confidence');
  for (const f of row.analysis?.risk_flags ?? []) reasons.push(`risk:${f}`);

  const needs_followup =
    row.needs_staff_followup === true || row.analysis?.staff_action_required === true;

  // "problem" = something went wrong / low quality — NOT merely a normal captured request that needs
  // staff follow-up. Risk flags like past_time / incomplete_booking count; a clean captured booking
  // that just needs confirmation does not.
  const problem = reasons.length > 0;

  return { problem, reasons, needs_followup };
}
