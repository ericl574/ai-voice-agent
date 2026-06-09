// Transcription model + language config for the call pipeline.
// Single swap point — see docs/call-pipeline.md.

// Per-turn caller transcription in the Realtime session (audio.input.transcription). We use
// `gpt-4o-transcribe` for accuracy — the staff-visible transcript should be close to ChatGPT
// dictation quality. The previous streaming model (`gpt-realtime-whisper`) was lower-accuracy on
// mumbled/unclear speech. This async input transcription is separate from the conversation model
// (`gpt-realtime`), so the agent's spoken reply speed is unaffected; only the transcript TEXT may
// land slightly later. Verified accepted by the current Realtime API (2026-06-08); supported set:
// whisper-1, gpt-realtime-whisper, gpt-4o-transcribe, gpt-4o-mini-transcribe (+ dated mini variants).
export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

// Post-call full-recording transcription (/v1/audio/transcriptions) — the batch FALLBACK source,
// used only when no usable Realtime caller turns were captured. Same high-accuracy family as the
// Realtime input transcription above, so primary and fallback are consistent.
export const BATCH_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

// Transcription language hint. UNSET (null) so transcription AUTO-DETECTS the caller's language —
// a hard 'en' hint biased non-English/code-switched audio toward English. This affects ONLY how
// caller audio is transcribed; the ASSISTANT's default response language stays English and is
// controlled by the prompt (globalRules LANGUAGE rules), not by this hint. When null, the session
// route omits `language` from audio.input.transcription entirely (never passes an empty string).
export const TRANSCRIPTION_LANGUAGE_HINT: string | null = null;
