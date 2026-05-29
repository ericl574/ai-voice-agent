// Transcription model + language config for the call pipeline.
// Single swap point — see docs/call-pipeline.md.

// Per-turn caller transcription in the Realtime session. Streaming-native and not on the
// ~June 2026 retirement list (unlike whisper-1 / gpt-4o-transcribe).
export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';

// Post-call full-recording transcription (/v1/audio/transcriptions) — the calls.transcript
// extraction source. gpt-realtime-whisper is streaming-only, so the batch path uses this.
export const BATCH_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

// Soft default language. This is a HINT, not a lock: ambiguous short clips are biased toward
// English (avoids mis-detecting English as another language), but a clearly non-English turn
// still transcribes in its own language.
export const TRANSCRIPTION_LANGUAGE_HINT = 'en';
