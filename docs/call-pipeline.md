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
  - `prefix_padding_ms: 300`, **`create_response: false`** (Layer 2 — the app creates responses, see
    §2a), `interrupt_response: false`
- `audio.input.noise_reduction: { type: 'far_field' }`.
- `audio.input.transcription: { model: 'gpt-4o-transcribe' }` (no `language`) — **enables per-turn
  caller transcription**, so each caller utterance arrives as its own event (see §2). This
  **prioritizes transcript accuracy over instant live-text speed**: `gpt-4o-transcribe` is close to
  ChatGPT dictation quality (the previous `gpt-realtime-whisper` was weaker on mumbled/unclear
  speech). This async input transcription is **separate from the conversation model**
  (`gpt-realtime`). ⚠️ **Under Layer 2 (§2a) the assistant reply now waits for this transcript**
  (the app gates response creation on it), so a reply lands ~1–2s after the caller stops — the
  deliberate "slower but safer" tradeoff. The transcript stays **verbatim** (no LLM cleanup/rewrite).
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

## 2a. Layer 2 — controlled response creation, intent gating & playback state (`voice/page.tsx`)

**Why:** with `create_response: true`, Realtime auto-created the assistant reply on VAD commit —
*before* the caller transcript arrived — so the app's noise/intent filter ran too late and background
speech/noise could trigger a reply or a duplicate. Layer 1 timeline evidence:
`speech_started → committed → response.created → transcription.completed → app:caller fragment
filtered`. Layer 2 makes response creation **app-owned** so the gate runs first.

- **App owns creation.** Session sets `create_response: false`; server VAD still commits the turn and
  runs input transcription, but the **browser** creates the reply. `sendResponseCreate(reason)` is the
  **single source of truth** for response creation (the only `dc.send({type:'response.create'})`).
  It sends exactly one response only when: data channel open, call connected, **no response in
  progress**, and **assistant audio not still playing** (else it defers — see below).
- **Wait-for-transcript + fail-open.** A response is created only after
  `conversation.item.input_audio_transcription.completed` passes the noise + intent gate. **Tradeoff:
  replies wait ~1–2s for the transcript — slower but safer.** A fail-open timer armed on
  `input_audio_buffer.committed` (`CALLER_TRANSCRIPT_FALLBACK_MS`) creates a response anyway if the
  transcript never lands, so the caller is never left in silence; it is cleared when the transcript
  arrives (valid **or** noise — so a noise-only turn never fail-open-triggers a reply). **No
  double-reply:** the fallback records the committed `item_id` it answered (`fallbackAnsweredItemsRef`);
  if that turn's transcript lands late, the text is still saved but a **second** `response.create` is
  suppressed (`app:late transcript after fallback — no second response`).
- **Caller-intent gate** (`classifyCallerIntent`, `src/lib/call-pipeline/intent.ts`): runs *after*
  `looksLikeNoiseOrEmpty`. Classifies accepted text as `backchannel | interruption | substantive`
  (conservative; whole-fragment acks only; non-Latin/multi-word → substantive). **A bare backchannel
  ("mhm"/"yeah") the caller spoke while the assistant was talking is ignored** — no reply, no state
  change, **not saved** (same early-return as noise). Suppression uses a **busy-at-speech-start
  snapshot** (`itemBusyAtSpeechRef`, captured at `speech_started` / `conversation.item.added`), **not**
  the live state at transcript-arrival time — the transcript lags ~1–2s, so checking live state would
  let backchannels over a short reply leak through after the assistant went idle. When the assistant
  was idle at speech start, "yeah"/"okay" is a real answer and flows through normally.
- **Hold-then-answer.** A *substantive* turn that arrives while the assistant is still speaking is
  **held** (`pendingCallerResponseRef`) and answered with exactly one response once the assistant is
  fully idle (`onAssistantSettled`, debounced; `PENDING_BACKSTOP_MS` backstop guards lost
  playback events). Consistent with `interrupt_response: false` — the assistant is never cut off.
- **Assistant playback state ≠ `response.done`.** `assistantAudioPlayingRef` is driven by
  `output_audio_buffer.started` (true) / `.stopped` / `.cleared` (false), tracked **separately** from
  `responseInProgress`. `response.done` is **not** treated as "caller heard the audio."
- **Background speech vs normal noise.** Normal environmental noise (fan/traffic) is handled at
  VAD + the noise helper and behaves well — **Layer 2 does not change VAD**. A *competing speaker*
  (clear background speech) is the hard case: the gate prevents a duplicate reply and state mutation,
  but the **server still clears assistant playback** (`output_audio_buffer.cleared`) on detected
  speech — the audio cut-off itself is **not** fixed here (deferred to a later VAD/playback layer).

## 2b. Voice event timeline — dev observability (`voice/page.tsx`)

A **dev-only** structured event timeline (`SHOW_TIMELINE = NODE_ENV !== 'production'`) records the
Realtime + app event flow so voice-pipeline bugs are diagnosed with **evidence, not guessing**. It is
the Layer 1 tool for the diagnosis-by-layer principle (§0). Rendered as a collapsible panel under the
Transcript on `/dashboard/voice`; **off in production builds**.

- **What it records:** every NON-`.delta` Realtime event generically (`recordVoiceEvent` in
  `handleRealtimeEvent`), plus `app:` action markers — Layer 2 decisions especially:
  `response.create sent` / `…blocked/response in progress` / `…blocked/assistant audio playing` /
  `…deferred (assistant speaking)` / `…flushed (deferred caller turn)`, `valid caller turn accepted`,
  `caller turn ignored/backchannel`, `caller fragment filtered (noise/junk)`, and auto end-call
  scheduled. (Raw `output_audio_buffer.*` events already show playback state, so playback is read from
  those rather than duplicated as `app:` markers.)
- **Fields:** `tMs` (ms since call start), `type`, `responseId`, `itemId`, `role`, short fixed
  `note`. Ring-buffered to the last `VOICE_EVENT_CAP` (300) events; reset on each new call.
- **Safety:** records ONLY event type / ids / role / a fixed note — **never payloads, transcript
  text, ephemeral tokens, or secrets**.
- **Headline signal — text vs audio:** the note deliberately distinguishes
  `response.(output_)audio_transcript.done` → *assistant TEXT complete (not audio)* from
  `response.(output_)audio.done` → *assistant AUDIO generation done* and
  `output_audio_buffer.stopped` → *assistant audio playback FINISHED*. If TEXT-complete fires but
  playback never FINISHED (or `output_audio_buffer.cleared` fires), the caller heard a **cut-off** —
  a playback/barge-in issue, not a prompt issue (§0). Two `response.created` without a caller turn
  between them = a **duplicate response**; caller VAD `speech_started` during assistant output = a
  potential **barge-in**.

This is observability only — it changes no call/transcript/extraction behavior.

## 2c. Audio capture lifecycle & cost safety (`voice/page.tsx`)

Browser audio + session hygiene so a test/trial call can't leak resources or run up Realtime minutes:

- **Mic capture:** `getUserMedia` with `echoCancellation`/`noiseSuppression`/`autoGainControl` on,
  `channelCount: 1`. `cleanup()` stops all mic tracks, stops `MediaRecorder`, closes the
  `RTCPeerConnection`, and clears every timer.
- **Max call duration:** a hard cap (`MAX_CALL_DURATION_MS`, 10 min) armed when the call goes live
  gracefully ends the call (`requestEndCall('max-duration')`) — a cost backstop above the ~5-min
  server session expiry. Cleared in `cleanup`/`resetForNewCall`.
- **Tab close/navigation:** a `pagehide`/`beforeunload` handler best-effort releases the mic + closes
  the peer connection so a closed tab mid-call doesn't keep a session alive until server expiry.
- **No parallel sessions:** `startCall` no-ops if a call is already `connecting`/`connected`.
- **Cost guards (server):** ephemeral client secret `expires_after` ~300 s; `voice-session` rate
  limited (~12/min/client).
- **Dev-only / secret safety (verified):** `SHOW_TIMELINE` + `api/debug/*` are gated to
  `NODE_ENV !== 'production'`; the ephemeral client secret and `OPENAI_API_KEY` are never logged.

## 2d. End-of-call — playback-aware ending + bounded drain (freeze)

All four ways a call ends funnel through **one** entry point, `requestEndCall(reason)` (reasons:
`manual` | `auto-end` | `inactivity` | `max-duration`). Ending is **playback-aware** — never a blind
fixed delay.

- **Drain-before-save:** `requestEndCall` enters an ending state (`endRequestedRef=true`, which makes
  `sendResponseCreate`/`deferCallerResponse` no-op so **no new response is created while ending**),
  drops any held turn, clears turn/inactivity/end-cue timers, then `drainThenStop` polls until the
  assistant is idle — `!responseInProgress && !assistantAudioPlaying && !pendingCallerResponse &&
  pendingCallerTranscriptRef.size===0` — **bounded by `END_DRAIN_MAX_MS` (3 s)**, then `stopCall`
  saves. Markers: `end drain complete — assistant idle, saving` vs `end wait timed out — saving best
  available transcript`. There is **no** legacy fixed post-stop delay.
- **`pendingCallerTranscriptRef`** (a `Set` of committed-but-not-yet-transcribed caller `item_id`s;
  added on `input_audio_buffer.committed`, deleted on `…transcription.completed` for any outcome) is
  the **explicit** pending-transcript signal for BOTH the drain and the inactivity check — *not* the
  fail-open `callerTurnFallbackTimerRef` (which clears when it fires while a transcript may still be
  pending).
- **Caller end-cue (playback-aware):** when `looksLikeEndCall` (`src/lib/call-pipeline/endCall.ts`,
  context-free; bare "thanks"/"no thanks" are **not** hard cues) matches, the app sets
  `endAfterReplyRef` and lets the assistant deliver its closing reply; `onAssistantSettled` calls
  `requestEndCall('auto-end')` once that reply has finished **playing**. `END_CUE_MAX_MS` (6 s) is a
  fallback if the closing reply never completes; a later non-cue caller turn cancels it.
- **Inactivity end (conservative):** `requestEndCall('inactivity')` after `INACTIVITY_END_MS` (28 s)
  of silence, armed only from `onAssistantSettled` and gated by `inactivityEndAllowed()`: **≥1
  substantive caller turn** (`substantiveCallerTurnSeenRef`) AND the assistant fully idle (so ≥1
  response has finished after that caller turn) AND no held response AND
  `pendingCallerTranscriptRef.size===0` AND not already ending. Reset on any caller `speech_started` /
  `input_audio_buffer.committed` / accepted caller turn. Never fires after just a greeting.
- **`response.done` is not playback completion** (§2a/§2b); ending waits on the audio-buffer state.

## Known limitations (frozen — do not "re-fix" without new evidence)

- **Server-side audio clear on a competing speaker:** `output_audio_buffer.cleared` is VAD-layer; the
  app only reflects it (`onAssistantSettled`, idempotent) and prevents a duplicate reply — it cannot
  stop the clear without VAD/architecture changes (out of MVP scope).
- **Trailing caller transcript past the drain bound:** if the caller's last words are still being
  transcribed when the 3 s drain bound elapses, they may not make the saved transcript.
- **Landing demo uses server auto-response, not the dashboard orchestration:** `CallSimulatorDemo`
  (the public "Try Our Service" widget) is a thin client with no data-channel handler; its session is
  minted with `create_response:true` (server auto-response) while the dashboard test call uses
  `create_response:false` (app-controlled). Full Layer-2 orchestration in the demo is deferred — it
  only needs to *work*, which it does.

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

## 5. Extraction — `src/lib/call-pipeline/postCallCore.ts` + `src/lib/call-pipeline/extraction.ts`

The extraction + record-creation core lives in `postCallCore.runPostCallExtraction()` (single
source of truth) behind two thin entry routes: `src/app/api/post-call/route.ts` (browser test
calls; authed user session) and `src/app/api/twilio/post-call/route.ts` (real phone calls saved
by the bridge; secret-guarded, service-role client with a server-pinned business id).

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
- **Completeness check (deterministic):** for an actionable request, `assessCollection(extraction,
  vertical.requiredFields)` reports which **core** fields (name/phone/date/time/service) are still
  missing; post-call appends `Missing from call: …` to `next_action` (→ appointment/SR `staff_notes`).
  Additive only — it does **not** change intent, record creation, status, or `needs_staff_followup`.
  Coarse by design (richer vertical details live in notes). `requiredFields` (per vertical, in
  `agents/core/types.ts` + `verticals/*`) is the **single source of truth** for completeness; phone is
  never required (product rule). The prompt renders these core fields (`promptBuilder.renderCoreFields`)
  as the *minimum* contract **alongside** `collectionPriorities` — they are **complementary** (core
  minimum vs vertical specifics like party size / vehicle / location), not a replacement.

## 6. Rendering — `src/app/dashboard/calls/page.tsx`

Call History loads `call_messages` ordered by `created_at` and renders **Front desk left, Caller
right** (`roleLabel()`), falling back to the raw `calls.transcript` column only when no messages
exist. The existing `calls.needs_staff_followup` flag is surfaced as a **"Follow-up" badge** + a
**"Needs follow-up" filter** (no schema change). Demo mode and `business_id` scoping are unchanged.

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
- **Deferred (documented, not built):** per-turn high-accuracy reconciliation (Layer 10) is **not**
  built — caller turns use `gpt-4o-transcribe` and that is the single transcript source of truth; a
  future second-pass reconciliation would be a *new* source and is out of scope until justified. VAD
  tuning (Layer 3) and the server-side audio-truncation fix (Layer 4) are also deferred; real-time
  tool/function-calling enforcement is intentionally not used (call state is prompt + post-call).

## Voice-bug diagnosis checklist

Work the layers (§0) top-down; capture evidence at each before proposing a fix:

1. **Caller turn missing?** Check the noise helper (`looksLikeNoiseOrEmpty`) — is the text being
   filtered? The `[FD debug] caller fragment accepted/filtered` log shows it. (Non-Latin text must
   be kept — the check is Unicode-aware.)
2. **Caller turn garbled?** Transcription model/quality (`gpt-4o-transcribe`), not the prompt.
3. **Assistant responded to noise / fired twice?** Layer 2 owns response creation (§2a): check the
   timeline for `app:response.create sent` vs the gate markers (`ignored/backchannel`, `filtered`,
   `deferred`, `blocked/*`). A reply with no preceding `app:response.create sent` would mean the
   server auto-created it — confirm `create_response:false`. Otherwise VAD threshold /
   `silence_duration` — not the prompt.
4. **Assistant audio cut off but transcript is full?** Playback / `interrupt_response` / barge-in —
   not the prompt. Use the **dev voice event timeline** (§2b): if `…audio_transcript.done` (TEXT
   complete) fires but `output_audio_buffer.stopped` (playback FINISHED) doesn't — or
   `output_audio_buffer.cleared` fires — the caller heard a cut-off.
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
