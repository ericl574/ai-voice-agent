# FrontDesk — P0-A Verification Packet + P0-B Real-Call Prep

*Verified 2026-07-02 against the working tree. Nothing committed — Eric commits/pushes.*

---

## 1. Git / file summary

**`git status --short`:**
```
 M docs/pilot-go-live.md
 M scripts/qa-units.ts
 M server/twilio-bridge.ts
?? report.md
```

**`git diff --stat`:**
```
 docs/pilot-go-live.md   |  20 ++++++--
 scripts/qa-units.ts     |  69 ++++++++++++++++++++++++-
 server/twilio-bridge.ts | 132 ++++++++++++++++++++++++++++++++++++++++++++++--
 3 files changed, 212 insertions(+), 9 deletions(-)
```

**Files modified by the P0-A patch:**
| File | Role in the patch | Δ |
|---|---|---|
| `server/twilio-bridge.ts` | The safety patch itself (caps, timers, idempotent finalize, trace logs) | +132 / −6 |
| `scripts/qa-units.ts` | 6 deterministic tests written test-first (RED→GREEN) | +69 / −1 |
| `docs/pilot-go-live.md` | Updated Step-5 trace-log expectations; corrected the now-outdated "no auto-hangup" line | +20 / −? |
| `report.md` | Untracked — the report file (not part of P0-A code) | new |

Not committed. `node_modules` and any lockfile changes are not staged (only the three tracked files above show as modified).

---

## 2. P0-A implementation proof (`server/twilio-bridge.ts`)

**Exact cap values** (`server/twilio-bridge.ts:52,55,58`, exported):
```ts
export const MAX_CALL_DURATION_MS = 10 * 60_000; // 600000 ms = 10 min
export const IDLE_TIMEOUT_MS      = 30_000;       // 30 s
export const END_CUE_DRAIN_MS     = 4_000;        // 4 s
```

**Where timers are created** (all inside the per-call closure `handleTwilioConnection`):
- Declared `null` at the top of the closure: `maxDurationTimer`, `idleTimer`, `endCueTimer`.
- `armMaxDuration()` (`:182–188`) creates `maxDurationTimer`; called once from the Twilio `start` message at **`:455`** (`armMaxDuration(); // cost backstop from the moment the call is live`). On expiry → `void finish('max-duration')`.
- `resetIdle()` (`:192–199`) creates/re-arms `idleTimer`; called on every meaningful activity: greeting sent (`:311`), assistant audio delta (`:343`), caller `input_audio_buffer.speech_started` (`:350`), caller transcript completed (`:366`). On expiry → `void finish('idle-timeout')`.
- `armEndCue(by)` (`:202–206`) creates `endCueTimer` when `looksLikeEndCall(text)` matches a caller turn (`:~370`) or an assistant turn (`:~385`). On expiry → `void finish('end-cue')`. Idempotent: `if (closed || endCueTimer) return` — only the first cue arms.

**Where timers are cleared:**
- `clearAllTimers()` (`:175–179`) clears all three and nulls them; called inside `finish()` at **`:404`**.
- `resetIdle()` clears the previous `idleTimer` before re-arming (`:194`).
- `cancelEndCue(reason)` (`:209–215`) clears `endCueTimer` when a caller keeps talking after a goodbye — invoked from the caller-transcript branch's `else cancelEndCue('caller continued')`, so a live call is never cut.

**How `finish()` / finalization is idempotent** (`:398–430`):
```ts
async function finish(reason: string): Promise<void> {
  if (closed) return;          // ← first caller wins; all later calls no-op
  closed = true;
  clearAllTimers();            // timers cleared exactly once
  ...
  const durationSec = Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
  log(`call ended (${reason}) — duration ${durationSec}s, ${turns.length} transcript turns`);
  ...
}
```
Every one of the six end paths funnels through this single `finish(reason)` — `max-duration`, `idle-timeout`, `end-cue`, `twilio stop` (`:485`), `twilio ws closed` (`:493`), `twilio ws error` (`:496`). The `if (closed) return` guard guarantees **exactly one** post-call and **one** timer-clear regardless of how many fire.

**How the Twilio socket close is handled:**
- `twilioWs.on('close', () => void finish('twilio ws closed'))` (`:493`).
- `twilioWs.on('error', …)` → logs then `void finish('twilio ws error')` (`:494–497`).
- Twilio `stop` control message → `void finish('twilio stop')` (`:485`).
- Inside `finish()`, `twilioWs.close()` is called in a `try/catch` (`:425–429`) so a double-close can't throw.

**How the OpenAI socket close is handled:**
- `openaiWs.on('close', …)` (`:391–394`) logs `openai closed` and sets `openaiReady = false`. **It does not itself call `finish()`.**
- `openaiWs.on('error', …)` (`:395`) logs only.
- Inside `finish()`, `openaiWs?.close()` is called in a `try/catch` (`:408–412`).
- **Backstop:** if OpenAI drops while Twilio stays connected, no further activity resets the idle timer, so `idleTimer` fires within 30 s → `finish('idle-timeout')` → the call still saves. (Disclosed as a residual risk in §4 — the save can lag up to 30 s.)

**How bridge errors are handled:**
- OpenAI API `error` event on `session.update` → retry once with the legacy audio-format shape (`triedLegacyFormat` guard, in the message handler) — pre-existing, unchanged.
- Malformed WS frames → `JSON.parse` in `try/catch`, early `return`.
- Twilio WS error → `finish('twilio ws error')`. OpenAI WS error → logged, backstopped by idle.

**How post-call is attempted** (`finish()`, `:413–424`):
```ts
if (turns.length > 0) {
  log('posting call for save + extraction…');
  await postCall({ businessId: businessId || null, fromNumber: fromNumber || null,
                   startedAt: started.toISOString(), endedAt: new Date().toISOString(), turns });
} else {
  log('no transcript turns captured — skipping post-call (nothing to save)');
}
```
`postCall()` (`:~130–142`) POSTs to `${APP_URL}/api/twilio/post-call` with the `x-bridge-secret` header.

**How post-call success/failure is logged:**
- Success path: `postCall()` logs `[bridge] post-call → ${res.status}` plus the parsed JSON body (`:140`) — the body includes `saved`/`extractionRan`, so `extraction_skipped_no_api_key` is visible here.
- Failure path: `console.error('[bridge] post-call failed:', err.message)`.
- **Honest caveat:** the `posting call for save + extraction…` line (`:414`) carries the per-call `traceId`, but `postCall()`'s own `post-call → status` line does **not** (it's a module-level function outside the closure). They print back-to-back, so correlation is trivial, but the status line itself is un-prefixed.

**How trace ids are generated and included:**
- `const traceId = randomUUID().slice(0, 8);` (`:150`, `randomUUID` imported from `crypto`).
- The per-call `log()` helper prefixes every line: `` `[bridge ${traceId}${streamSid ? '/' + streamSid.slice(-6) : ''}] ${msg}` `` — so lines are correlatable **before** the Twilio `streamSid` arrives, and gain the stream suffix after `start`. No secrets or caller text appear in any trace line.

---

## 3. Test results (actual output)

**`npm run qa:units`:**
```
────────────────────────────────────────────────────────────────

✓  All 84 tests passed.
```

**`npm run qa:call-pipeline`:**
```
────────────────────────────────────────────────────────────────

✓  All 46 tests passed.
```

**`npm run build`:**
```
✓ Compiled successfully in 5.0s
BUILD OK (exit 0)
```

All three run and pass. (Note from the handoff: these are deterministic value/wiring/parse checks — they prove the bridge module loads, the caps are sane and ordered, and the wiring strings exist. They do **not** exercise a live socket/timer or the live model; that is what P0-B tests.)

---

## 4. Remaining risks after P0-A (honest)

P0-A makes the phone path **safe to test**. It does **not** make it correct, complete, or verified. What it does **not** solve:

1. **Phone path still has no Layer 2 turn-taking.** The bridge still uses the server's auto-response (`create_response` default true). None of the browser's app-side noise/intent gate, hold-then-answer, or playback-aware reply logic runs on phone. Under noise/competing speech the original double-reply/early-reply failure modes can still occur. P0-A only added *endings*, not *turn-taking*.
2. **The real Twilio call is still untested.** Zero real calls have run end-to-end. The 30 s idle / 4 s drain / 10 min cap values are first guesses, unvalidated against real call cadence. Codecs, trial-account notices, and signature/env drift are all unexercised.
3. **Live extraction is still untested.** `gpt-4o-mini` extraction (`postCallCore.ts`) — the thing that determines report quality — has no CI coverage; only the deterministic keyword fallback is tested. First real transcripts must be eyeballed.
4. **A bridge crash mid-call still loses turns.** `turns[]` is in-memory and only flushed to `/api/twilio/post-call` inside `finish()`. If the bridge process dies (OOM, unhandled throw, host restart) before `finish()`, the entire transcript for that call is lost. P0-A did not add incremental persistence.
5. **Twilio REST hangup is not implemented.** End-cue / idle / max-duration end the call by **closing the WebSockets** (`openaiWs.close()` + `twilioWs.close()`), not by a Twilio REST `Hangup`. On most setups closing the media stream ends the PSTN leg, but this is unverified on a real call and is not a guaranteed hangup.
6. **OpenAI socket close doesn't directly finalize.** As noted in §2, an OpenAI drop while Twilio stays up relies on the 30 s idle timeout to finalize — so the save can lag up to ~30 s and the caller hears silence in that window.
7. **Report email / domain / cron still unverified.** `NOTIFY_EMAIL_FROM` (sender domain) is likely unset → the daily email silently skips. Vercel Hobby fires the digest cron once/day at 13:00 UTC; per-business send-hour timing is unverified. None of the reporting deliverable has been confirmed end-to-end.
8. **Post-call status line lacks the traceId** (cosmetic; see §2).

None of 1–8 block a *controlled, supervised* first call. Items 1, 3, 5, 7 are the P1/P2 work the test will inform.

---

## 5. P0-B — first real Twilio call setup checklist

### Vercel env vars (Next app)
| Var | What it does |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public origin, `https`, **no trailing slash**. Used for OG/sitemap/report links **and the Twilio signature match** — must EXACTLY equal the webhook origin or every inbound call 403s. |
| `TWILIO_AUTH_TOKEN` | Validates the inbound Twilio webhook signature in `/api/twilio/voice`. |
| `TWILIO_STREAM_URL` | `wss://<bridge-host>/twilio-stream` — the bridge WS the TwiML `<Stream>` points at. |
| `TWILIO_BRIDGE_SECRET` | Shared secret guarding `/api/twilio/session-config` + `/api/twilio/post-call`. **Must equal the bridge's value.** |
| `TWILIO_BUSINESS_ID` | Which `businesses.id` answers this line. **Unset → demo restaurant, call is NOT saved.** Set it to the pilot business. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the phone post-call save the call + load the business prompt (server-side only). |
| `OPENAI_API_KEY` | **App-side** = the post-call extraction/analysis. Missing → call talks but report says "analysis pending" (`extraction_skipped_no_api_key`). |
| `CRON_SECRET` | Guards `/api/cron/digest` (needed only for the morning report, not the call). |
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | Email report + CSV. Until `NOTIFY_EMAIL_FROM` (verified sender domain) is set, email skips safely. Not required for the call itself. |
| `OPS_ALERT_SMS_TO` *(optional)* | Operator incident SMS; skips if unset. |

### Bridge host env vars (`server/twilio-bridge.ts`)
| Var | What it does |
|---|---|
| `OPENAI_API_KEY` | **Required.** The live voice (bridge → OpenAI Realtime WS). Never logged. |
| `TWILIO_BRIDGE_SECRET` | **Required.** Same value as the Vercel app; authorizes session-config + post-call. |
| `FD_APP_URL` | The Vercel origin the bridge calls back to (session-config + post-call). Default `http://localhost:3000`. |
| `BRIDGE_PORT` / `PORT` *(optional)* | Listen port. Default `8787`. |
| `OPENAI_REALTIME_MODEL` *(optional)* | Default `gpt-realtime`. |
| `TWILIO_TRANSCRIPTION_MODEL` *(optional)* | Default `gpt-4o-transcribe`. |

> `OPENAI_API_KEY` must be on **both** the app and the bridge. Bridge-only → the call talks but the report says "analysis pending."

### Twilio Console settings
- **Voice webhook:** Phone Numbers → your number → Voice → **"A call comes in"** → **Webhook** = `https://<your-vercel-domain>/api/twilio/voice`, method **HTTP POST**.
- **Media Stream URL:** *not* set in the console — it's the **`TWILIO_STREAM_URL` env** on Vercel, value `wss://<bridge-host>/twilio-stream`. The app injects it into the `<Connect><Stream>` TwiML.
- **Protocol:** the stream URL must be `wss://…` (secure WebSocket). ngrok/Railway give you `https://…` — swap the scheme to `wss://` and keep the `/twilio-stream` path.
- **Signature-mismatch gotcha:** `/api/twilio/voice` verifies Twilio's signature against `${NEXT_PUBLIC_SITE_URL}/api/twilio/voice`. If `NEXT_PUBLIC_SITE_URL` differs from the webhook origin by **scheme, host, `www`, or a trailing slash**, you get a silent **403** and the call drops with no app error. After changing any Vercel env var, **redeploy** (env applies only to new deployments).

### How to run the bridge
**Local test (ngrok):**
```bash
npm run twilio:bridge        # terminal 1 → listens on :8787, reads .env.local
ngrok http 8787              # terminal 2 → copy the https host
# set TWILIO_STREAM_URL=wss://<ngrok-host>/twilio-stream on Vercel, then REDEPLOY
```
(Free ngrok host changes every run — update the env + redeploy each time.)

**Durable host (Railway/Render/Fly):** deploy this repo as an always-on service, start command `npm run twilio:bridge`, healthcheck path `/health`, crash-restart on. Then `TWILIO_STREAM_URL=wss://<railway-host>/twilio-stream`.

### How to place the first test call (say this)
1. **Wait for the disclosure + greeting** — don't speak first (pre-greeting audio is discarded by design).
2. **Ask one business question** (tests the KB): *"Hi — what are your hours today?"*
3. **Request a callback / appointment** (tests capture + extraction): *"My name is Alex Kim. Can someone call me back tomorrow around 3pm? My number is 604-555-0142."*
4. **Say goodbye** (tests the end-cue shutdown): *"Okay, that's all — goodbye."*

Then confirm the call in the dashboard's **Call History**.

### What success looks like
Bridge trace (one `traceId` per call, e.g. `[bridge a1b2c3d4/xxxxxx]`):
```
stream started (business: <id>)
session-config loaded (business: <name>)        ← NOT the fallback warning
session ready (discarded N pre-greeting frames) — greeting caller
first assistant audio → caller
first caller transcript captured
end-cue detected (caller) — draining 4s then closing     (or: idle-timeout / max-duration)
call ended (end-cue) — duration Ns, M transcript turns
posting call for save + extraction…
[bridge] post-call → 200  {"saved":true,"extractionRan":true,...}
```
And in the app: the call appears in **Call History** with a **two-sided transcript** and a **real summary** (name Alex Kim, callback request, hours question), the appointment/callback shows in the dashboard, and there is **no `extraction_skipped_no_api_key`** and **no `USING FALLBACK INSTRUCTIONS`** in the logs. Bonus: a deliberately silent call closes with `call ended (idle-timeout)` after ~30 s and still saves.

### What failure looks like
| Symptom / log | Meaning → fix |
|---|---|
| Call connects then drops; **no app log**; Twilio shows **403** | Signature mismatch — `NEXT_PUBLIC_SITE_URL` ≠ webhook origin (scheme/host/www/trailing slash). Fix env, **redeploy**. |
| `⚠️ USING FALLBACK INSTRUCTIONS — business identity/KB NOT loaded` | `/api/twilio/session-config` unreachable — wrong `TWILIO_BRIDGE_SECRET` or `FD_APP_URL`, or app down. Caller heard a generic desk. |
| Summary "analysis pending" / `post-call → 200 {"extractionRan":false...}` / `extraction_skipped_no_api_key` | `OPENAI_API_KEY` missing **on the app** (it's fine on the bridge but must be on both). |
| `[bridge] post-call → 4xx/5xx` or `post-call failed:` | Save/extraction route rejected it — check `TWILIO_BRIDGE_SECRET` parity, `SUPABASE_SERVICE_ROLE_KEY`, and that the `call_digests`/`calls_source` migrations ran. |
| `stream started` but **no `first caller transcript captured`** | Caller audio not reaching OpenAI or transcription empty — codec/mic issue; check `session ready` fired and media frames flow. |
| `session ready` but **no `first assistant audio → caller`** | Model didn't produce audio — check the greeting `response.create` fired and no OpenAI `error` line precedes it. |
| `openai closed` / `twilio ws closed` **before** `session-config loaded` | WS dropped before setup — bridge unreachable at `TWILIO_STREAM_URL`, wrong `wss://` host/path, or bridge crashed. |
| `call ended (idle-timeout)` mid-conversation | 30 s idle fired during a real pause — the value is too aggressive for this caller; raise `IDLE_TIMEOUT_MS`. |
| `call ended (max-duration)` on a normal call | Hit the 10 min cap — expected only for very long calls; raise `MAX_CALL_DURATION_MS` if legitimate. |

---

## 6. Final recommendation

**Yes, ready for controlled real phone testing.**

The P0-A safety patch closes the three conditions that made a real call unsafe to attempt: runaway cost (10-min `MAX_CALL_DURATION_MS`), dangling/abandoned calls (30-s `IDLE_TIMEOUT_MS`), and no clean ending (deterministic goodbye `END_CUE_DRAIN_MS` + idempotent single-`finish()` finalize), with per-call trace logging that makes a real call debuggable. All 84 + 46 tests pass and the build is clean. No blocking **code** patch remains — the outstanding work for P0-B is **external account/env setup** (Twilio number, bridge host, env on both sides, redeploy), not code.

Two honest guardrails on that "yes": keep the first calls **supervised**, and treat the residual risks in §4 — no Layer 2 turn-taking, untested live extraction, in-memory transcript loss on a bridge crash, socket-close (not REST) hangup, unverified reporting — as **things the test will surface**, not things already solved.

This is readiness for the **first controlled real phone test only** — not pilot readiness, not paid-customer readiness.
