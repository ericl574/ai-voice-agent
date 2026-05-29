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
- `audio.input.transcription: { model: 'whisper-1' }` — **enables per-turn caller
  transcription**, so each caller utterance arrives as its own event (see §2). Without this,
  caller turns collapse into a single Whisper blob.
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
  turn (requires the §1 transcription config).
- A catch-all `console.log('[FD debug] event:', type)` surfaces every event type for debugging
  if a future model changes event names.
- Browser SpeechRecognition still runs for **live captions only** — never the saved source.

## 3. Save — `saveCall()` in `voice/page.tsx`

On End Call: insert the `calls` row, then **one `call_messages` row per captured turn** (both
sides), role mapped `assistant → 'assistant'`, `user → 'customer'`, in capture order so
`created_at` reflects conversation order.

## 4. Caller audio + official transcript — `src/app/api/transcribe-call/route.ts`

`MediaRecorder` captures the caller mic; the blob is POSTed here and transcribed with Whisper
(`whisper-1`). The combined text (assistant lines + `Caller:`-prefixed lines) is written to
`calls.transcript` — **the source of truth for extraction**. This route does **not** insert a
caller `call_messages` row (the per-turn rows from §3 already cover the caller side; inserting
the flat blob would duplicate it).

## 5. Extraction — `src/app/api/post-call/route.ts` + `src/lib/call-pipeline/extraction.ts`

Runs the model over `calls.transcript`:

- `callerLinesOnly()` isolates `Caller:` lines so front-desk phrasing never leaks into intent.
- Appointment intent **wins over** service request; an appointment-only call must **not**
  create a service request.
- `caller_name` / `caller_phone` extracted only if stated — **phone is optional**, never
  required to create a pending appointment.
- Appointments are always created `status: 'pending'` (staff confirms — CLAUDE.md rule 15).
- Deterministic keyword guardrails are a fallback layer; the model is primary.
- Covered by `npm run qa:call-pipeline` (36 tests, no network/DB).

## 6. Rendering — `src/app/dashboard/calls/page.tsx`

Call History loads `call_messages` ordered by `created_at`. `TranscriptPanel` renders **Front
desk on the left, Caller on the right**. `roleLabel()` maps `assistant/ai/agent/front_desk` →
"Front desk" and `caller/user/customer` → "Caller".

## Invariants

- Both sides must appear in Call History for a real two-sided call.
- Caller turns stay separate (no single combined blob).
- Phone optional; appointments default pending; appointment-only ≠ service request.
- `npm run qa:call-pipeline` and `npm run build` must pass before any commit.
