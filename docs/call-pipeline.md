# FrontDesk — Call Pipeline

End-to-end flow for the browser voice test (`/dashboard/voice`): how a live call becomes a
saved, readable, two-sided transcript in Call History plus a structured appointment/service
extraction. Model is `gpt-realtime` (do not swap without Eric's approval). The values below mirror
the code — keep this doc in sync when the pipeline changes.

## 1. Session config — `src/app/api/voice-session/route.ts`

Server mints an ephemeral client secret (`POST /v1/realtime/client_secrets`). The OpenAI API
key never leaves the server. Session payload includes:

- `model: gpt-realtime`, `instructions: <system prompt>` (built by `buildSystemPrompt`).
- `audio.input.turn_detection` — **server VAD tuned conservatively** so background noise /
  breathing / partial words don't chain-trigger responses:
  - `threshold: 0.70` (default ~0.5 — caller must speak more clearly; raised for noisy calls)
  - `silence_duration_ms: 1000` (default ~500 — wait a full second before closing a turn)
  - `prefix_padding_ms: 300`, `create_response: true`, `interrupt_response: false`
- `audio.input.noise_reduction: { type: 'far_field' }`.
- `audio.input.transcription: { model: 'gpt-4o-transcribe' }` (no `language`) — **enables per-turn
  caller transcription**, so each caller utterance arrives as its own event (see §2). This
  **prioritizes transcript accuracy over instant live-text speed**: `gpt-4o-transcribe` is close to
  ChatGPT dictation quality (the previous `gpt-realtime-whisper` was weaker on mumbled/unclear
  speech). This async input transcription is **separate from the conversation model**
  (`gpt-realtime`), so the **agent's spoken reply stays fast** — only the transcript *text* may
  appear slightly later in the live view. The transcript stays **verbatim** (no LLM cleanup/rewrite).
  **Language auto-detects:** `TRANSCRIPTION_LANGUAGE_HINT` is `null`, so the `language` field is
  omitted and Chinese / code-switched callers transcribe in their own language. The **assistant's**
  default response language is still English, switching only on a clearly non-English caller — that
  is **prompt-driven** (`globalRules` LANGUAGE rules), independent of this transcription setting.
  Model + language constants live in `src/lib/call-pipeline/constants.ts` (`gpt-4o-transcribe`
  verified accepted by the Realtime API 2026-06-08).
- **Current business time:** the prompt's BUSINESS INFO injects today + the current local time via
  `nowInTimeZone(business.timezone)` (`src/lib/call-pipeline/time.ts`), computed once at session
  creation, so the agent can answer "what time is it?" and reject same-day past times. See
  `promptBuilder.ts`.
- **Demo isolation:** a `{ demo: true, businessType }` body builds the prompt from
  `getDemoBusiness()` and never reads the signed-in account (see `docs/demo-architecture-debt.md`).

## 2. Live capture — `src/app/dashboard/voice/page.tsx` (`handleRealtimeEvent`)

Each turn becomes a `TranscriptEntry { id, role: 'user' | 'assistant', text }`:

- **Assistant (Front desk):** `response.audio_transcript.delta/.done` (preview) **and**
  `response.output_audio_transcript.delta/.done` (GA) accumulate text; `response.output_item.done`
  is a backup; `conversation.item.added` / `conversation.item.created` is the authoritative catch.
- **Caller:** `conversation.item.input_audio_transcription.completed` — one entry per caller turn.
  This is the **single source** for caller turns, driving the live transcript and `call_messages`.
- **Noise handling:** caller fragments are passed through `looksLikeNoiseOrEmpty()`
  (`src/lib/call-pipeline/noise.ts`, the one approved noise helper). Empty/punctuation-only/obvious
  hallucination fragments are dropped before they reach the transcript, the save path, or end-call
  detection; valid short replies (yes/no/dates/times/names/phone) are preserved. The check is
  **Unicode-aware** (`\p{L}`/`\p{N}`): non-Latin caller text (Chinese/Japanese/Korean/Arabic/
  Cyrillic/…) is real content and must **not** be dropped as noise.
- **Caller-turn ordering:** an empty placeholder is inserted on `conversation.item.added` for the
  user item; the transcription event fills it in place. Empty placeholders are hidden in the UI and
  excluded from save.

## 3. Save — `saveCall()` in `voice/page.tsx`

On End Call: insert the `calls` row, then **one `call_messages` row per captured turn** (both
sides), role mapped `assistant → 'assistant'`, `user → 'customer'`, in capture order. Caller
noise/junk is excluded (Option A).

## 4. Transcript source of truth — Realtime primary, batch fallback

**The live Realtime transcript is the source of truth** for `calls.transcript` and post-call
extraction — it is more accurate than the post-call batch recording.

- `buildTranscript(entries, looksLikeNoiseOrEmpty)`
  (`src/lib/call-pipeline/transcript.ts`) assembles `calls.transcript` from the Realtime turns,
  role-labeled and interleaved in conversation order (`Front desk:` / `Caller:`), dropping empty
  placeholders and caller noise; assistant turns are never filtered; no duplicates. The role-label
  strings are exported as `FRONT_DESK_LABEL` / `CALLER_LABEL` from that file — the canonical format.
- **Batch transcription is FALLBACK ONLY.** When `countCallerTurns(entries) === 0` (no usable
  Realtime caller speech), `MediaRecorder` audio is POSTed to
  `src/app/api/transcribe-call/route.ts` and transcribed with `gpt-4o-transcribe`
  (`BATCH_TRANSCRIPTION_MODEL`). That route **must not overwrite a good Realtime transcript** — it
  only writes `calls.transcript` when the existing value is empty/placeholder or has no `Caller:`
  lines. It never inserts a caller `call_messages` row. ⚠️ Batch transcribe models retire ~June 2026.

## 5. Extraction — `src/app/api/post-call/route.ts` + `src/lib/call-pipeline/extraction.ts`

Runs the model over `calls.transcript` (now the Realtime-primary transcript, or the batch fallback):

- `callerLinesOnly()` isolates `Caller:` lines so front-desk phrasing never leaks into **intent**.
  (It depends on the `CALLER_LABEL` format owned by `transcript.ts`; a contract test in
  `qa:call-pipeline` locks the two in sync.)
- Appointment intent **wins over** service request; an appointment-only call must not create a
  service request.
- **Contact / appointment VALUES** are sourced from the **Front Desk's confirmation/read-back** when
  present (caller speech-to-text is lossy on digits). Intent still comes only from caller lines.
  **Phone is optional.**
- **Displayed phone correction:** the saved `call_messages` caller turn matching `looksLikePhone()`
  is overwritten with the confirmed `caller_phone`; `runPostCall` does the same to the live view.
- Appointments are always created `status: 'pending'` (staff confirms). Keyword guardrails are a
  fallback layer; the model is primary. Covered by `npm run qa:call-pipeline`.

## 6. Rendering — `src/app/dashboard/calls/page.tsx`

Call History loads `call_messages` ordered by `created_at` and renders **Front desk left, Caller
right** (`roleLabel()`), falling back to the raw `calls.transcript` column only when no messages
exist.

## Invariants

- Realtime transcript is primary; batch is fallback and never overwrites it.
- Both sides appear in Call History for a real two-sided call; caller turns stay separate.
- Noise filtering uses the single `looksLikeNoiseOrEmpty` helper; never over-aggressive.
- Phone optional; appointments default pending; appointment-only ≠ service request.
- `npm run qa:call-pipeline`, `npm run qa:units`, and `npm run build` must pass before any commit.
