# PILOT_ACTIVATION.md — turn FrontDesk on for ONE real business (concierge)

The exact, ordered runbook for a **developer-run concierge pilot** — one real business, one phone
number, you doing the setup. Not self-serve. Do it top to bottom once (~60–90 min the first time).
Deeper refs: `docs/deployment-checklist.md`, `docs/supabase-rls-verification.md`, `docs/pilot-go-live.md`,
`docs/first-customer-onboarding.md`.

> Two runtimes on purpose: **Next app → Vercel** (webhook, save, extraction, report cron, ops view);
> **bridge → a durable Node host** (Railway/Render/Fly) because Twilio Media Streams need a persistent
> WebSocket that Vercel serverless can't host. Use ngrok for the very first test call.

---

## Step 1 — Supabase migrations (SQL editor, in order)

The base schema (businesses, calls, call_messages, appointments, service_requests, business_knowledge,
business_members) is assumed already present in your project. Apply these additive migrations:

- `supabase/migrations/20260702000000_business_twilio_number.sql` — **required** (number → business routing; `pilot:map` needs it)
- `supabase/migrations/20260616000000_call_digests.sql` — required for the morning report
- `supabase/migrations/20260709000000_calls_analysis.sql` — recommended (post-call analyst → `calls.analysis`)
- `supabase/migrations/20260702000001_pilot_requests.sql` — recommended (durable `/contact` leads)
- `supabase/migrations/20260611000001_calls_source.sql` — optional (marks phone calls `source='phone'`)

Skip `20260611000000_billing_subscriptions.sql` (Stripe — not part of the pilot) and
`20260606_reservation_auto_confirm.sql` (auto-confirm SMS is stubbed; the pilot uses staff-confirm).

## Step 2 — RLS checks (the hard safety gate)

Follow `docs/supabase-rls-verification.md`. Run the read-only Step-1 queries and confirm **every**
business-data table has RLS enabled **and** a `business_id`-scoped policy — and remember the write
foot-gun (the browser writes `calls`/`call_messages`/`appointments`/`business_knowledge`/`businesses`,
so those need read **and** write policies, per §2b). **Do not onboard a second business until this passes.**
Test dashboard writes on a staging copy after enabling RLS.

## Step 3 — Vercel env vars (the Next app)

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | post-call analysis (**also** required on the bridge — Step 4) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client/auth |
| `SUPABASE_SERVICE_ROLE_KEY` | save phone calls, load prompt, routing, ops view (server-only) |
| `NEXT_PUBLIC_SITE_URL` | must EXACTLY equal the Twilio webhook origin (https, no trailing slash) |
| `TWILIO_AUTH_TOKEN` | verify the inbound webhook signature |
| `TWILIO_STREAM_URL` | `wss://<bridge-host>/twilio-stream` |
| `TWILIO_BRIDGE_SECRET` | shared secret (same value on the bridge) |
| `CRON_SECRET` | guards `/api/cron/digest` **and** `/api/ops/calls` |
| `OPS_ALERT_SMS_TO` (+ `TWILIO_ACCOUNT_SID`/`TWILIO_PHONE_NUMBER`) | failure alerts by SMS |
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | morning email report (domain-gated — Step 8) |

After any env change on Vercel, **redeploy** (env only applies to new deployments).

## Step 4 — Bridge host env vars

On the durable host running `npm run twilio:bridge`:

| Var | Value |
|---|---|
| `OPENAI_API_KEY` | same key as the app |
| `TWILIO_BRIDGE_SECRET` | same value as the app |
| `FD_APP_URL` | your Vercel origin (`https://<domain>`) |

Health check: `GET /health` on the bridge returns ok. Keep crash-restart on.

## Step 5 — Twilio phone number

1. Twilio Console → Buy a **Voice-capable** number (trial is fine for the first call — it plays a short notice).
2. Note the number in E.164, e.g. `+16045550100`.

## Step 6 — Twilio webhook

Phone Numbers → your number → Voice → **A call comes in**:
Webhook `https://<your-vercel-domain>/api/twilio/voice`, **HTTP POST**.
(Signature gotcha: `NEXT_PUBLIC_SITE_URL` on Vercel must exactly equal this origin, or inbound calls 403.)

## Step 7 — Map the business to the number

The business owner's profile must exist first (they sign up + onboard, or you create it). Get the
`businesses.id` from Supabase, then:

```bash
npm run pilot:map -- <business_id> "+16045550100"
```

This verifies the business exists, saves `businesses.twilio_number` (E.164), and prints the remaining
checklist. Read-only check (no write): omit the number. Requires `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (the script loads it automatically).

Load the business's Knowledge Base + hours/greeting in Settings before the call — the agent answers
only from that (`docs/first-customer-onboarding.md`).

## Step 8 — Email report (optional for go-live)

Verify a sender domain in Resend and set `NOTIFY_EMAIL_FROM` (e.g. `FrontDesk <alerts@yourdomain>`) +
`RESEND_API_KEY`, redeploy. Until then email **skips safely** — pilot on the dashboard + CSV and say so.
Manual trigger to test: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/digest`.

## Step 9 — First real acceptance call

1. Bridge up, Vercel env set + redeployed, `businesses.twilio_number` mapped (Step 7).
2. Call the number from a phone. Expect: automated-front-desk disclosure → greeting in the business
   name → a normal booking/question chat → hang up.
3. Confirm in the app: **Call History** shows the two-sided transcript + a **real** summary (not
   "analysis pending"); any appointment/service request appears (status **Pending**).

## Step 10 — Logs & monitoring (what to check)

- **Bridge logs** (per-call trace id `[bridge xxxxxxxx/xxxxxx]`):
  `stream started` → `session-config loaded (business: …)` → `first assistant audio → caller` →
  `first caller transcript captured` → `call ended (<reason>) …` → `post-call → 200`.
- **Operator failed-call view** (across the pilot, no login):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/ops/calls?hours=48"
  ```
  Returns `{ problems, needs_followup, calls: [...] }`; problem calls first, each with `reasons`
  (e.g. `capture_or_analysis_failed`, `low_confidence`, `risk:past_time`).
- **Vercel logs**: `[FD]` lines (post-call save/extraction, digest).
- **Ops SMS**: with `OPS_ALERT_SMS_TO` set, failed saves/extractions/digests + low-quality calls page you.

## Success vs failure

**Success:** the call connects with the business's identity, the transcript + a real summary save, a
`Pending` request appears when the caller wanted one, and `/api/ops/calls` shows the call with **no**
problem reasons.

**Failure signals + fixes:**
- `⚠️ USING FALLBACK INSTRUCTIONS` in bridge logs → session-config didn't load (wrong
  `TWILIO_BRIDGE_SECRET`/`FD_APP_URL`, or app down). Fix before trusting any call.
- Summary "analysis pending" / no caller name → `OPENAI_API_KEY` missing on the **app** (Step 3). Watch
  Vercel logs for `extraction_skipped_no_api_key`.
- Inbound call 403 → `NEXT_PUBLIC_SITE_URL` ≠ the Twilio webhook origin (Step 6).
- Dead air / dropped call → check the bridge is running + `TWILIO_STREAM_URL` matches its public wss URL.
- `/api/ops/calls` shows `problems > 0` → open those call ids in Call History and review the transcript.

## Known pilot limits (state honestly)

- Appointments are captured **Pending** — staff confirm; the agent never says "booked/confirmed".
- Email report needs a verified sender domain (Step 8) — dashboard + CSV meanwhile.
- One bridge process (single host) — fine for pilot volume, not for scale.
- Self-serve phone provisioning, Stripe billing, and native SDK agent handoffs are **not** in this pilot.
