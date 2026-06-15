// Context-free detection of a clear caller "end the call" cue, for the browser voice pipeline.
//
// IMPORTANT — this helper is deliberately CONTEXT-FREE: it sees one caller utterance and cannot know
// what the assistant just asked. So it only matches UNAMBIGUOUS hard end cues ("bye", "that's all",
// "nothing else", "no that's it", "I'm done", "we're done", "hang up", …). It intentionally does NOT
// treat a bare "thanks" / "thank you" / "no thanks" as an end cue — those are ambiguous on their own.
// The natural close after the assistant's "anything else?" for a "thanks"/"no thanks"/"all good"
// reply comes from prompt behavior plus the playback-aware / inactivity end flow in voice/page.tsx,
// not from this helper. A new question in the same breath (a "?", or an info word like "hours")
// cancels the match so "thanks, what are your hours?" is never an end. Bias is toward NOT ending.
//
// Pure + self-contained (no imports) so the Node QA runner can unit-test it (scripts/qa-units.ts).
export function looksLikeEndCall(raw: string): boolean {
  const text = raw.toLowerCase().trim();
  if (!text) return false;
  // A new substantive question in the same breath ("thank you, what are your hours?") → not an end.
  if (text.includes('?')) return false;
  if (/\b(what|when|where|how|why|who|which|hours|open|price|cost|available|do you|are you|can you|could you|would you)\b/.test(text)) {
    return false;
  }
  return /\b(bye bye|bye|goodbye|that'?s all|all good|nothing else|no,? that'?s it|end the call|hang up|you can hang up|i said goodbye|i'?m done|i am done|we'?re done|we are done)\b/.test(text);
}
