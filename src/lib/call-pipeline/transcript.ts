// Canonical role-label prefixes for an assembled transcript line. These are an implicit contract
// shared across the pipeline (assembly here, the batch fallback in /api/transcribe-call, the
// post-call extraction prompt, and callerLinesOnly() in extraction.ts). Reference these constants
// from any Next-compiled consumer instead of re-hardcoding the strings. (extraction.ts is imported
// by the Node QA runner, which can't resolve cross-file relative imports, so it keeps its own
// `Caller:` regex — a contract test in qa:call-pipeline locks the two in sync.)
export const FRONT_DESK_LABEL = 'Front desk:';
export const CALLER_LABEL = 'Caller:';

// A captured conversation turn from the Realtime session (live transcript state).
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

// Predicate that flags obvious caller noise/junk (Option A). Injected rather than imported so this
// module stays dependency-free and unit-testable; callers pass `looksLikeNoiseOrEmpty`.
export type NoisePredicate = (text: string) => boolean;

const NEVER_NOISE: NoisePredicate = () => false;

// Returns the caller turns that count as real speech: non-empty and not obvious noise/junk.
// Used to decide whether the Realtime transcript is usable or we must fall back to batch transcription.
export function countCallerTurns(
  entries: TranscriptTurn[],
  isNoise: NoisePredicate = NEVER_NOISE,
): number {
  return entries.filter(
    (e) => e.role === 'user' && e.text.trim().length > 0 && !isNoise(e.text.trim()),
  ).length;
}

// Assembles the official call transcript from the in-memory Realtime turns, in conversation order:
//   Front desk: ...
//   Caller: ...
//   Front desk: ...
// Drops empty placeholders and obvious caller noise/junk (Option A, via isNoise); never drops
// assistant turns. This is the primary source of truth saved to calls.transcript and fed to
// post-call extraction — the live Realtime transcript is more accurate than the batch recording.
export function buildTranscript(
  entries: TranscriptTurn[],
  isNoise: NoisePredicate = NEVER_NOISE,
): string {
  const lines: string[] = [];
  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    if (e.role === 'assistant') {
      lines.push(`${FRONT_DESK_LABEL} ${text}`);
    } else {
      if (isNoise(text)) continue; // caller noise/junk — keep it out of the saved transcript
      lines.push(`${CALLER_LABEL} ${text}`);
    }
  }
  return lines.join('\n');
}
