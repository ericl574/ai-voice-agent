# Manual Voice QA — Troubleshooting Checklist (call/voice freeze)

Run AFTER automated QA passes (`npm run build`, `npm run qa:units`, `npm run qa:call-pipeline`). This
is the one human voice session that gates the call/voice freeze. It is **troubleshooting-focused**:
each step lists the expected **dev voice event timeline** evidence (`/dashboard/voice`, dev build, the
"Voice event timeline · dev" panel). If a step fails, the marker tells you which layer to look at.

Run in a `dev` build (`npm run dev`) so `SHOW_TIMELINE` is on. Use a real mic + speaker.

## Client 1 — Dashboard test call (`/dashboard/voice`) — the orchestrated pipeline

### A. Normal turn-taking
1. Start a call, ask a simple question. → assistant replies once. Timeline: `valid caller turn
   accepted` → `response.create sent` → … → `response.done`, audio plays fully.
2. Book an appointment over several turns. → one reply per turn; no duplicates.

### B. Noise / background speech
3. Have someone speak clearly nearby while you stay silent. → **no duplicate assistant reply**, no
   booking-state change. Timeline: `caller turn ignored/backchannel` or a `filtered` / held turn.
4. Say "mhm"/"yeah" *while the assistant is speaking*. → ignored (not saved). Timeline: `caller turn
   ignored/backchannel`.
5. Real interruption mid-reply with a substantive request. → held, answered once after the assistant
   finishes. Timeline: `response.create deferred (assistant speaking)` → `flushed (deferred caller turn)`.

### C. End-of-call (the freeze focus)
6. Mid-reply, say "bye". → the assistant finishes its **closing** line (not cut off), then the call
   ends and saves. Timeline: `end-call cue detected — will end after closing reply` →
   `end-call cue — closing reply finished, ending` → `end requested — draining before save` →
   `end drain complete — assistant idle, saving`. The saved transcript **includes** the closing line.
7. After the assistant asks "anything else?", answer **"no thanks"** (NOT a hard cue). → assistant
   gives a short closing line (prompt behavior); then either it ends via a subsequent hard cue, or the
   **inactivity** path closes it. Timeline: eventually `inactivity end — caller silent after assistant
   idle` if you stay silent ~28 s.
8. Have a real exchange, then go silent ~30 s. → graceful end. Timeline: `inactivity end …` →
   `end requested — draining before save` → save. **Must NOT** fire before a real exchange or during
   a reply.
9. Click **End call** mid-reply. → bounded drain (≤3 s) captures the in-flight line, then saves.
   Timeline: `end requested — draining before save` → `end drain complete …` (or `end wait timed out
   — saving best available transcript` if >3 s).
10. Let a call run to `MAX_CALL_DURATION_MS` (10 min) without ending. → `max call duration reached —
    ending call` → drain → save. (Optional / long.)

### D. Cut-off vs full audio (diagnosis)
11. Stay silent while the assistant speaks a full sentence. → it finishes. If a competing speaker
    triggers `output_audio_buffer.cleared`, that is the **documented server-side limitation** — confirm
    no duplicate reply follows.

### E. Save / transcript integrity
12. After any saved call, open Call History → transcript is interleaved, role-correct, excludes
    ignored backchannels/noise, no duplicate assistant rows, closing line present. `needs_staff_followup`
    shows as the "Follow-up" badge where applicable.

## Client 2 — Landing "Try Our Service" demo (`CallSimulatorDemo`, home page)

The regression that B0 fixed — verify it **speaks at all**:
13. On the landing page, "Try It Yourself" → pick a service → "Call the … agent" → speak. → **the
    agent audibly responds** (server auto-response; `create_response:true` for `demo:true`). It is
    unsaved and has no dev timeline — this is just a "does it talk back" check.
14. End the demo / switch service / navigate away → mic released, no lingering session.

## Pass criteria
- Every End-of-call step ends the call (no hang) AND never cuts off the closing line within the bound.
- Inactivity end never fires prematurely.
- No duplicate replies from background speech.
- Landing demo agent speaks.
- Saved transcript is clean.

If all pass: the call/voice subsystem is freeze-confirmed for MVP.
