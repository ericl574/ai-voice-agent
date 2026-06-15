// Conservative caller-intent classifier for a single ACCEPTED caller transcript fragment.
//
// This runs AFTER looksLikeNoiseOrEmpty (src/lib/call-pipeline/noise.ts) has already dropped obvious
// noise/junk, so it only ever sees text that is at least plausibly real caller speech. It exists for
// Layer 2 controlled response creation: the voice page uses the result to decide whether a fragment
// that arrives WHILE the assistant is speaking should be ignored (a bare acknowledgement) or treated
// as a real caller turn that deserves a response once the assistant finishes.
//
// Design rules (mirror noise.ts):
//   - Deterministic, Unicode-aware, and biased HARD against over-classifying. When unsure → treat as
//     a real ('substantive') turn so genuine callers are NEVER blocked.
//   - 'backchannel' is matched ONLY when the WHOLE fragment is a known bare acknowledgement, never as
//     a substring ("okay" → backchannel; "okay tomorrow at five" → substantive).
//   - 'no' is NEVER a backchannel — it is a meaningful answer (and an end-call cue elsewhere).
//   - Non-Latin / multi-token text → substantive (real content).
//
// IMPORTANT: the voice page only SUPPRESSES a backchannel when the assistant is currently speaking.
// When the assistant is idle, even a "yeah"/"okay" is a valid answer and is handled normally — that
// decision lives in the page, not here. This keeps the classifier a pure, testable function.

export type CallerIntent = 'backchannel' | 'interruption' | 'substantive';

// Bare acknowledgements that carry no instruction on their own. Matched only as the WHOLE fragment.
// Kept small and obvious on purpose. (Note: "yeah"/"okay"/"sure"/"right" can be real affirmations —
// they are only suppressed while the assistant is mid-speech; see file header.)
// NOTE: entries must be in NORMALIZED form (lowercase; hyphens/punctuation already turned into
// single spaces), since matching is against the normalized fragment — e.g. "mm-hmm" → "mm hmm".
const BACKCHANNEL_EXACT = new Set<string>([
  'mhm', 'mm', 'mmhm', 'mmhmm', 'mhmm', 'mm hmm', 'mm hm', 'uhhuh', 'uhuh', 'uh huh',
  'yeah', 'yep', 'yup', 'yeah yeah',
  'ok', 'okay', 'kay', 'k',
  'right', 'sure', 'gotcha', 'got it', 'i see',
  'uh', 'um', 'umm', 'uhh', 'hmm', 'hm', 'ah', 'oh', 'oh ok', 'oh okay',
]);

// Explicit control / interruption phrases. Matched as a SUBSTRING of the normalized fragment, since
// these are intentional and meaningful even inside a longer utterance ("no actually I want to
// change that"). Conservative list — only unambiguous control language.
const INTERRUPTION_SUBSTRINGS: string[] = [
  'wait',
  'stop',
  'hold on',
  'hang on',
  'no actually',
  'actually no',
  'never mind',
  'nevermind',
  'cancel that',
  'change that',
  'i want to change',
  'i need to change',
  'back to english',
  'in english',
  'speak english',
];

// Normalize identically to noise.ts: lowercase, non-letter/number → space, collapse whitespace.
// Unicode-aware so non-Latin letters are preserved (and therefore never match the English sets).
function normalize(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyCallerIntent(text: string): CallerIntent {
  const normalized = normalize(text);
  if (!normalized) return 'substantive'; // empty after normalize shouldn't happen post-noise-filter; be safe

  // Explicit control language wins — even mid-utterance.
  for (const phrase of INTERRUPTION_SUBSTRINGS) {
    if (normalized.includes(phrase)) return 'interruption';
  }

  // Bare acknowledgement only when the WHOLE fragment is one.
  if (BACKCHANNEL_EXACT.has(normalized)) return 'backchannel';

  // Everything else is a real caller turn.
  return 'substantive';
}
