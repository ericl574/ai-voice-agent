// Conservative classifier for a single caller transcript fragment.
//
// Returns true ONLY for obvious junk so the caller turn can be skipped before it is saved to
// call_messages or used for end-call detection. It is deliberately biased HARD against false
// positives: a real short reply ("yes", "no", "Friday", "2 PM", a name, a phone fragment) must
// never be classified as noise. When unsure, return false (keep the fragment).
//
// What it filters:
//   - empty / whitespace-only
//   - punctuation/symbol-only ("." , "..." , "?!" , "-")
//   - an exact-match list of hesitation fillers and common speech-to-text silence/noise
//     hallucinations (matched only when the WHOLE fragment is that token, never as a substring)

// Matched against the fully normalized fragment (lowercased, punctuation→spaces, collapsed).
// Every entry here must be something that is NEVER a meaningful standalone caller answer.
const NOISE_EXACT = new Set<string>([
  // hesitation fillers — no information on their own
  'uh', 'uhh', 'uhm', 'um', 'umm', 'er', 'erm', 'hmm', 'ah',
  // well-documented Whisper / speech-to-text hallucinations on silence or background noise
  'you',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subscribe',
  // bracketed audio artifacts some models emit (brackets are stripped during normalization)
  'blank audio',
  'inaudible',
  'silence',
]);

export function looksLikeNoiseOrEmpty(text: string): boolean {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return true;

  // No letters or digits at all → punctuation/symbol-only fragment. Unicode-aware: `\p{L}` matches
  // letters in ANY script (Chinese/Japanese/Korean/Arabic/Cyrillic/…), so non-Latin caller turns
  // are real content and are NOT treated as noise.
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;

  // Normalize for the exact-match junk check: lowercase, turn any non-letter/number into a space,
  // collapse whitespace. Unicode-aware strip preserves non-Latin letters (so e.g. 我想改时间 stays
  // 我想改时间 → not in the English NOISE_EXACT set → kept). English behavior is unchanged
  // ("Thanks for watching!" → "thanks for watching"; "that's all" → "that s all", kept).
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return true;
  return NOISE_EXACT.has(normalized);
}
