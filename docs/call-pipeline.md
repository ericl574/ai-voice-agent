# FrontDesk — Call Pipeline

End-to-end flow for the browser voice test (`/dashboard/voice`): how a live call becomes a
saved, readable, two-sided transcript in Call History plus a structured appointment/service
extraction. Model is `gpt-realtime` (do not swap without Eric's approval). The values below mirror
the code — keep this doc in sync when the pipeline changes.

## 0. Voice-bug diagnosis — diagnose by layer, not prompt-first

**Voice bugs are NOT prompt-only by default.** A real-time call is an orchestration of many layers;
a symptom can originate in any of them. Before changing the prompt, identify which **layer** is
actually failing.

Orchestration layers (caller speaks → staff sees the result):

```txt
caller audio input
→ browser microphone capture        (getUserMedia, echo/noise/gain, mono, start timing, clipping)
→ noise / background-speech handling (what counts as a real caller turn)
→ VAD / turn detection              (server_vad threshold, silence_duration, prefix_padding)
→ endpointing                       (when a caller turn is considered finished)
→ interruption / barge-in control   (interrupt_response, whether caller speech truncates the reply)
→ Realtime response creation        (create_response → assistant turn begins)
→ assistant audio generation        (model speaks)
→ assistant audio playback          (browser plays it; did it finish or get cut off?)
→ transcript turn capture           (Realtime events → TranscriptEntry)
→ saved transcript                  (calls.transcript via buildTranscript; call_messages rows)
→ post-call extraction              (summary / appointment / service request)
```

Distinguish, because they have different fixes:

- **Background noise** — non-speech audio (fan, traffic). Should NOT create a caller turn. Fix at
  VAD / `noise_reduction` / the noise helper, not the prompt.
- **Background speech** — other people talking near the caller. Hard; conservative VAD + the noise
  helper reduce it. Not a prompt issue.
- **Real caller interruption (barge-in)** — the caller intentionally talks over the assistant.
  Controlled by `interrupt_response` (currently `false`, so the assistant finishes its turn).
- **Backchannel** — "mhm", "yeah", "ok" while the assistant talks. Should not derail the turn or be
  treated as a new request.

**Assistant transcript vs what the caller actually heard:** the saved/displayed assistant transcript
is the *generated* text, which can differ from the *audio the caller heard*. If the transcript shows
a **full** assistant sentence but the caller heard it **cut off**, that is a **playback /
interruption / barge-in** problem — diagnose audio playback completion and `interrupt_response`
**before** touching the prompt.

Design intent: **Realtime is used for speed; orchestration (VAD, endpointing, barge-in, capture)
provides reliability; higher-accuracy post-turn transcription is the future accuracy path.** Today
caller turns use `gpt-4o-transcribe` for accuracy (§1); a fuller post-turn reconciliation pass is a
later option, not built yet.

A concrete diagnosis checklist is at the end of this doc.

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

## Cross-cutting rules

- **Business local time:** the prompt injects today + the current local time at session creation via
  `nowInTimeZone(business.timezone)` (computed once — no live refresh for MVP). The agent uses it for
  "what time is it?", "today"/"tomorrow", same-day past-time rejection, and business-hours checks,
  and must **never** ask the caller what time it is. (See §1; `promptBuilder.ts`.)
- **Language policy:** transcription auto-detects the caller's language (no `language` hint); the
  assistant's response language is prompt-driven and "newest clear request wins" — full behavior in
  `docs/agent-behavior.md`.
- **Ambiguity on critical fields:** for date/time/service/name/phone, prefer the front-desk
  read-back as the value of record when caller speech-to-text is lossy; clarify once if unclear.
- **Appointment/request safety:** appointments default `status: 'pending'` (staff confirms); never
  claim "confirmed"; appointment intent wins over service request; phone optional.

## Voice-bug diagnosis checklist

Work the layers (§0) top-down; capture evidence at each before proposing a fix:

1. **Caller turn missing?** Check the noise helper (`looksLikeNoiseOrEmpty`) — is the text being
   filtered? The `[FD debug] caller fragment accepted/filtered` log shows it. (Non-Latin text must
   be kept — the check is Unicode-aware.)
2. **Caller turn garbled?** Transcription model/quality (`gpt-4o-transcribe`), not the prompt.
3. **Assistant responded to noise / fired twice?** VAD threshold / `silence_duration` / barge-in —
   not the prompt.
4. **Assistant audio cut off but transcript is full?** Playback / `interrupt_response` / barge-in —
   not the prompt.
5. **Assistant said the wrong thing / wrong language / wrong industry?** Now it's prompt/behavior —
   see `docs/agent-behavior.md` and `globalRules.ts`.
6. **Saved transcript wrong but live was fine?** Source-of-truth assembly (`buildTranscript`) or the
   batch fallback overwriting — §4.
7. **Extraction wrong?** Input to extraction is `calls.transcript` — verify it first, then
   `extraction.ts`.

Only conclude "prompt fix" after layers 1–4 and 6–7 are ruled out.

## Invariants

- Realtime transcript is primary; batch is fallback and never overwrites it.
- Both sides appear in Call History for a real two-sided call; caller turns stay separate.
- Noise filtering uses the single `looksLikeNoiseOrEmpty` helper; Unicode-aware; never over-aggressive.
- Phone optional; appointments default pending; appointment-only ≠ service request.
- `npm run qa:call-pipeline`, `npm run qa:units`, and `npm run build` must pass before any commit.
