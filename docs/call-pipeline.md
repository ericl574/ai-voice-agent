# FrontDesk AI — Call Pipeline

End-to-end flow for the browser voice test (`/dashboard/voice`): how a live call becomes a
saved, readable, two-sided transcript in Call History plus a structured appointment/service
extraction. Model is `gpt-realtime-mini` (do not swap without approval — CLAUDE.md rule 17).

## 1. Session config — `src/app/api/voice-session/route.ts`

Server mints an ephemeral client secret (`POST /v1/realtime/client_secrets`). The OpenAI API
key never leaves the server. Session payload includes:

- `model: gpt-realtime-mini`, `instructions: <system prompt>`.
- `audio.input.turn_detection` — **server VAD tuned conservatively** so background noise /
  breathing / partial words don't chain-trigger responses:
  - `threshold: 0.65` (default ~0.5 — caller must speak more clearly)
  - `silence_duration_ms: 1000` (default ~500 — wait a full second before closing a turn)
  - `prefix_padding_ms: 300`, `create_response: true`
- `audio.input.transcription: { model: 'gpt-realtime-whisper', language: 'en' }` — **enables
  per-turn caller transcription**, so each caller utterance arrives as its own event (see §2).
  Without this, caller turns collapse into a single Whisper blob. The model is OpenAI's current
  recommended streaming transcription model (`whisper-1` is weak at language detection and is
  retiring ~June 2026). `language` is a **soft hint, not a lock**: it biases ambiguous short clips
  toward English but a clearly non-English turn still transcribes in its own language. Model +
  language constants live in `src/lib/call-pipeline/constants.ts`.
- **Prompt rules** (`GLOBAL_RULES`): default language English (switch only on clear caller
  preference); on silence/unclear/noisy audio, wait instead of re-prompting; never chain
  "take your time" prompts.

If tuning is still too sensitive/insensitive, adjust `threshold` / `silence_duration_ms` here.

## 2. Live capture — `src/app/dashboard/voice/page.tsx` (`handleRealtimeEvent`)

Each turn becomes a `TranscriptEntry { id, role: 'user' | 'assistant', text }`:

- **Assistant (Front desk):** `response.audio_transcript.delta/.done` (preview) **and**
  `response.output_audio_transcript.delta/.done` (GA) accumulate text; `response.output_item.done`
  is a backup; `conversation.item.added` / `conversation.item.created` is the authoritative
  catch (carries role + content even if delta events don't fire).
- **Caller:** `conversation.item.input_audio_transcription.completed` — one entry per caller
  turn (requires the §1 transcription config). This is the **single source** for caller turns,
  driving both the live transcript and the saved `call_messages` rows.
- **Caller-turn ordering:** the model replies instantly but caller transcription lands ~1-2 s
  later, so ordering by completion time would put the caller turn *after* the reply. To prevent
  that, an **empty placeholder** is inserted on `conversation.item.added` for the user item (which
  joins the conversation before the assistant responds); the transcription event fills it in place.
  Empty placeholders are hidden in the UI and excluded from save.
- A catch-all `console.log('[FD debug] event:', type)` surfaces every event type for debugging
  if a future model changes event names.
- Caller transcription is fully server-side (works in all browsers). Browser SpeechRecognition
  was removed — it duplicated each caller turn and mislabeled assistant speech (picked up from the
  speakers) as the caller.

## 3. Save — `saveCall()` in `voice/page.tsx`

On End Call: insert the `calls` row, then **one `call_messages` row per captured turn** (both
sides), role mapped `assistant → 'assistant'`, `user → 'customer'`, in capture order so
`created_at` reflects conversation order.

## 4. Caller audio + official transcript — `src/app/api/transcribe-call/route.ts`

`MediaRecorder` captures the caller mic; the blob is POSTed here and transcribed with
`gpt-4o-transcribe` (best accuracy / language recognition; `gpt-realtime-whisper` is
streaming-only so it can't run on the batch `/v1/audio/transcriptions` endpoint) using the same
soft `language: 'en'` hint. The combined text (assistant lines + `Caller:`-prefixed lines) is
written to `calls.transcript` — **the source of truth for extraction**. This route does **not**
insert a caller `call_messages` row (the per-turn rows from §3 already cover the caller side;
inserting the flat blob would duplicate it). Model + language constants live in
`src/lib/call-pipeline/constants.ts`. ⚠️ All batch transcribe models retire ~June 2026 — revisit
`BATCH_TRANSCRIPTION_MODEL` then.

## 5. Extraction — `src/app/api/post-call/route.ts` + `src/lib/call-pipeline/extraction.ts`

Runs the model over `calls.transcript`:

- `callerLinesOnly()` isolates `Caller:` lines so front-desk phrasing never leaks into **intent**.
- Appointment intent **wins over** service request; an appointment-only call must **not**
  create a service request.
- **Contact / appointment detail VALUES** (`caller_name`, `caller_phone`, `requested_date`,
  `requested_time`) are sourced from the **Front Desk's confirmation/read-back** when present —
  that reflects what the model actually understood, since the caller's own speech-to-text is lossy
  on digits (a phone can be heard as `7070 798 5201` while the model confirmed `778-798-5201`).
  Intent still comes only from caller lines. **Phone is optional** — never required for a pending
  appointment.
- **Displayed phone correction:** after extraction, the saved `call_messages` caller turn that
  `looksLikePhone()` (extraction.ts) is overwritten with the confirmed `caller_phone` (server side,
  here), and `runPostCall` does the same to the live transcript — so Call History and the live view
  show the confirmed number. Name/date are corrected in the saved appointment but display as
  transcribed.
- Appointments are always created `status: 'pending'` (staff confirms — CLAUDE.md rule 15).
- Deterministic keyword guardrails are a fallback layer; the model is primary.
- Covered by `npm run qa:call-pipeline` (pure-function tests, no network/DB).

## 6. Rendering — `src/app/dashboard/calls/page.tsx`

Call History loads `call_messages` ordered by `created_at`. `TranscriptPanel` renders **Front
desk on the left, Caller on the right**. `roleLabel()` maps `assistant/ai/agent/front_desk` →
"Front desk" and `caller/user/customer` → "Caller".

## Invariants

- Both sides must appear in Call History for a real two-sided call.
- Caller turns stay separate (no single combined blob).
- Phone optional; appointments default pending; appointment-only ≠ service request.
- `npm run qa:call-pipeline` and `npm run build` must pass before any commit.
