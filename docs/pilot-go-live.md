# Pilot Go-Live — Turn the Phone On (single page)

Everything the **code** needs for a real after-hours pilot is already built and OpenAI-verified
(`docs/twilio-setup.md` §"What is honest about the current state"). What remains is **external
account setup** — this page is the exact, ordered list. Do it top to bottom once; it takes ~60–90
minutes the first time. Deeper reference: `docs/twilio-setup.md`, `docs/after-hours-report.md`.

> The two halves of the system live in different places on purpose:
> - **Next app** → Vercel (webhook, save, extraction, morning-report cron).
> - **Bridge** (`server/twilio-bridge.ts`) → a durable Node host (Twilio Media Streams needs a
>   persistent WebSocket; Vercel serverless cannot host one). Use **ngrok** for today's test call,
>   **Railway/Render/Fly** for the pilot.

## The exact blockers (nothing else is in the way)

1. A Twilio account + one Voice-capable number.
2. The bridge running somewhere durable, reachable at `wss://<host>/twilio-stream`.
3. Env vars set on **both** the Vercel app and the bridge (table below).
4. The Twilio number's "A call comes in" webhook pointed at `https://<domain>/api/twilio/voice`.
5. `OPENAI_API_KEY` set on **BOTH** the bridge and the app. *(Bridge only → the call talks but the
   morning report says "analysis pending." The app now logs `extraction_skipped_no_api_key` loudly
   if you miss this — watch for it.)*
6. For the morning report: a Resend sender domain (`NOTIFY_EMAIL_FROM`) — until set, email skips
   safely and the Settings card shows the domain notice; SMS still works.

## Step 1 — Twilio number (~10 min)
1. Create a Twilio account (trial is fine — trial calls play a short Twilio notice first).
2. Buy a Voice-capable number.
3. Phone Numbers → your number → Voice → **A call comes in**: Webhook
   `https://<your-vercel-domain>/api/twilio/voice`, **HTTP POST**.

> **Signature gotcha (silent 403, call drops):** `/api/twilio/voice` verifies Twilio's signature
> against `${NEXT_PUBLIC_SITE_URL}/api/twilio/voice`. `NEXT_PUBLIC_SITE_URL` on Vercel must EXACTLY
> equal the webhook origin — same host, `https`, **no trailing slash, no `www` mismatch**. Change an
> env var → **redeploy** (env only applies to new deployments).

## Step 2 — Run the bridge

**Today's test (ngrok):**
```bash
npm run twilio:bridge          # terminal 1 → listening on :8787 (reads .env.local)
ngrok http 8787                # terminal 2 → copy the https URL
```
Set `TWILIO_STREAM_URL=wss://<ngrok-host>/twilio-stream` on Vercel + redeploy. (Free ngrok URL
changes every run — update + redeploy each time.)

**Pilot (Railway):** deploy this repo as an always-on service, start command `npm run twilio:bridge`,
healthcheck path `/health`, keep crash-restart on. Then set `TWILIO_STREAM_URL=wss://<railway-host>/twilio-stream`.

## Step 3 — Environment variables

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Vercel | must equal the Twilio webhook origin (signature) |
| `TWILIO_AUTH_TOKEN` | Vercel | verifies the inbound webhook signature |
| `TWILIO_STREAM_URL` | Vercel | `wss://<bridge-host>/twilio-stream` |
| `TWILIO_BRIDGE_SECRET` | Vercel **and** bridge | shared secret for session-config + post-call |
| `TWILIO_BUSINESS_ID` | Vercel | which `businesses.id` answers the line *(unset → demo restaurant, not saved)* |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | save phone calls + load the business prompt |
| `OPENAI_API_KEY` | bridge **and** Vercel | bridge = the voice; app = the morning-report analysis |
| `FD_APP_URL` | bridge | the Vercel origin the bridge calls back to |
| `CRON_SECRET` | Vercel | guards `/api/cron/digest` |
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | Vercel | the morning report email + CSV |

`TWILIO_ACCOUNT_SID` / `TWILIO_PHONE_NUMBER` are only needed for the optional SMS alert + ops alerts.

## Step 4 — Migrations (Supabase SQL editor)
- `supabase/migrations/20260616000000_call_digests.sql` — required for the morning report.
- `supabase/migrations/20260611000001_calls_source.sql` — optional; marks phone calls `source='phone'`.

## Step 5 — Acceptance call (the moment of truth)
1. Bridge up, ngrok/Railway up, Vercel env set + redeployed, `TWILIO_BUSINESS_ID` = the pilot business.
2. Call the number. Expect: disclosure → greeting in the business name → a normal booking chat → hang up.
3. Confirm bridge logs: `stream started` → `session ready (discarded N pre-greeting frames)` →
   `post-call → 200`.
4. Confirm in the app: the call (transcript + a **real** summary, not "analysis pending") shows in
   **Call History**, and any appointment/service request appears in the dashboard.
5. If summary says "analysis pending" with no caller name → `OPENAI_API_KEY` is missing on the app
   (Step 3). Check Vercel logs for `extraction_skipped_no_api_key`.

## Step 6 — Morning report
1. Settings → After-hours report: enable the email report, set the report email, pick the send hour,
   keep Attach CSV on. (Domain notice until `NOTIFY_EMAIL_FROM` is set — expected.)
2. Manual trigger (works on any plan, before trusting the cron):
   ```bash
   curl -X POST https://<your-domain>/api/cron/digest -H "Authorization: Bearer $CRON_SECRET"
   ```
   Returns `{ ok, processed, sent }`. With captured calls today + local time past the send hour, the
   report + CSV arrive. (Vercel Hobby = one daily cron at `0 13 * * *`; set each pilot's send hour
   at/before that tick.)

## Known limits to state honestly to the pilot
- One env-configured number → one business (per-business numbers are a later phase).
- Reservation auto-confirm SMS is stubbed; **staff-confirm is the supported flow**.
- One report per business per local day; no retry on a failed send (the call stays saved).
- After "goodbye" the agent won't auto-hang-up — prompt-enforced only.
