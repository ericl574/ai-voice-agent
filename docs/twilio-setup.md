# Twilio Real Phone Line — Setup Guide

The code path is complete and the OpenAI side is verified (a simulated phone stream received
real assistant audio back through the bridge). What remains is Twilio account setup and choosing
where the **bridge** runs.

## Architecture (why there are two pieces)

```
Caller's phone ──► Twilio number ──► POST /api/twilio/voice   (Next app, Vercel-hostable)
                                        └─ TwiML: disclosure + <Connect><Stream>
Twilio Media Stream ◄──ws──► twilio-bridge (standalone Node, NOT Vercel) ◄──ws──► OpenAI Realtime
                                        └─ on hangup: POST /api/twilio/post-call → saves the call
                                           + runs the same extraction as browser calls
```

**The one hosting constraint:** Twilio Media Streams needs a durable WebSocket server. Vercel
serverless cannot host one, so the bridge (`server/twilio-bridge.ts`) runs separately:

- **For tomorrow's test:** run it on your Mac + expose with ngrok (steps below).
- **For production:** deploy the same file to any always-on Node host (Railway / Render / Fly).

Audio is G.711 μ-law end-to-end (Twilio's native format; OpenAI accepts `audio/pcmu`) — no
transcoding, low latency.

## 1. Twilio account + number (~10 min)

1. Create a Twilio account (trial works; trial calls play a short Twilio notice first).
2. Buy a Voice-capable number (a Canadian local number is fine).
3. Phone Numbers → your number → Voice Configuration → **A call comes in**:
   Webhook `https://<your-domain>/api/twilio/voice`, HTTP POST.

> **Signature gotcha (causes a silent 403):** `/api/twilio/voice` verifies Twilio's signature
> against `${NEXT_PUBLIC_SITE_URL}/api/twilio/voice`. So **`NEXT_PUBLIC_SITE_URL` (on Vercel) must
> exactly equal the webhook origin you set here — same host, `https`, and NO trailing slash.** A
> mismatch (trailing slash, `www`, a different domain) returns 403 and the call drops. After setting
> or changing `TWILIO_STREAM_URL` / `NEXT_PUBLIC_SITE_URL` / any Vercel env, **redeploy** — env
> changes only apply to new deployments, and a fresh ngrok URL means a new `TWILIO_STREAM_URL` +
> redeploy each time.

## 2. Environment variables

**Next app (Vercel):**
```
TWILIO_AUTH_TOKEN=…            (Console → Account Info; used to verify webhook signatures)
TWILIO_STREAM_URL=wss://<bridge-host>/twilio-stream
TWILIO_BRIDGE_SECRET=<generate one: openssl rand -hex 24>
TWILIO_BUSINESS_ID=<businesses.id to answer as>   (optional — demo restaurant answers if unset)
SUPABASE_SERVICE_ROLE_KEY=…    (needed to save phone calls + load the business prompt)
NEXT_PUBLIC_SITE_URL=https://<your-domain>
```
For the inbound phone call, `TWILIO_ACCOUNT_SID` / `TWILIO_PHONE_NUMBER` aren't required. They
**are** required if you turn on **Call Delivery SMS** (texting the business after each call) —
see `docs/call-delivery-setup.md`:
```
TWILIO_ACCOUNT_SID=AC…        (Console → Account Info)
TWILIO_PHONE_NUMBER=+1…       (SMS-capable "from" number; reuse the inbound number if it sends SMS)
```

**Bridge (local `.env.local` is read automatically by `npm run twilio:bridge`, or host env):**
```
OPENAI_API_KEY=sk-…            (already in .env.local locally)
TWILIO_BRIDGE_SECRET=<same value as the app>
FD_APP_URL=https://<your-domain>   (where /api/twilio/session-config + post-call live)
BRIDGE_PORT=8787                   (optional)
```

## 3. Run the bridge locally + ngrok (test path)

```bash
# terminal 1 — the bridge
npm run twilio:bridge          # → listening on :8787

# terminal 2 — public WSS tunnel for Twilio
ngrok http 8787                # copy the https URL, e.g. https://abc123.ngrok.app
```

Set `TWILIO_STREAM_URL=wss://abc123.ngrok.app/twilio-stream` in Vercel and redeploy (or use
`vercel env` + redeploy). Note: a free ngrok URL changes each run — update the env var when it
does.

## 4. Run the migration for call-source marking (optional but recommended)

Supabase SQL editor → `supabase/migrations/20260611000001_calls_source.sql` (adds a nullable
`source` column to `calls`; phone calls save with `source='phone'`. The save path also works
without it.)

## 5. Acceptance test — "call from my own phone"

1. Bridge running, ngrok up, Vercel env vars set.
2. Call the Twilio number from your phone.
3. Expect: the short automated-front-desk disclosure, then the FrontDesk greeting; have a normal
   booking conversation; hang up.
4. Check: bridge terminal shows `stream started` → `session ready` → `post-call → 200`; the call
   (with transcript + summary) appears in **Call History**, and any appointment/service request
   shows in the dashboard (when `TWILIO_BUSINESS_ID` is set — demo-fallback calls are not saved).

### Call-quality QA (run after a real call — regression checks)

Verify on the saved call + transcript (these are the behaviors fixed for real phone; see
`docs/call-pipeline.md` §8 and the eval cases `GREETING-001`, `LANG-CHAOS-*`,
`SAFETY-NOINVENT-PARTY-001`, `CLOSING-NOLOOP-001`):

1. **Greeting** opens with one complete sentence including the business name (not "…calling the
   front", not truncated). Bridge log shows `discarded N pre-greeting frames`.
2. **Language:** say "Hallo" → stays English. Say "我能说中文吗?" → may switch to Chinese and stays
   there. Then toss in Korean/Japanese fragments → it asks once which language you prefer, doesn't
   chase, and never mixes two languages in one reply.
3. **No invented details:** ask to book "tomorrow, maybe 7pm" but don't give a party size → it asks,
   and never states a number/name you didn't give; the saved call is **not** marked Resolved.
4. **Status:** an incomplete/actionable call shows **Pending** (Follow-up), not Resolved; summary is
   real (not "analysis pending"). `select status, intent, summary, next_action from calls order by
   created_at desc limit 1;`
5. **End-of-call (known limitation):** after goodbye it should not loop. If the caller keeps talking
   the assistant may still answer (no auto-hangup yet — prompt-enforced only; see §8).

## What is honest about the current state

- **Code-complete and OpenAI-verified:** webhook + signature validation, TwiML, the bridge
  audio loop (validated against the live OpenAI Realtime API with a simulated Twilio client),
  barge-in clear, transcript capture, save + extraction reuse.
- **Not yet exercised:** a real Twilio call end-to-end (needs the account/number/ngrok above) —
  expect possible small fixes on first real call (e.g. trial-account notices, regional codecs).
- **Single-number MVP:** one env-configured number → one business. Per-business numbers need a
  `business_phone_numbers` mapping table (future phase).
- **Disclosure:** every call opens with "automated front desk … may be processed and summarized"
  before connecting — keep this; it's the recording/processing disclosure baseline for BC.
