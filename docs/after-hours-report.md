# After-Hours Report (Daily Digest) — Setup & How It Works

This is the FrontDesk MVP delivery model. **FrontDesk protects calls you were already missing** —
it answers when the business is closed or unavailable, captures the caller's details, and sends the
owner **one daily report** (email summary + CSV, with an optional one-line SMS). No per-call
spam, and no second dashboard to monitor.

## The key idea: "after-hours" comes from call forwarding, not from our code

FrontDesk only *receives* a call when the business's phone system forwards it (carrier "forward
when closed / on no-answer / busy"). So the calls FrontDesk captures are exactly the ones that were
already being missed. The digest reports everything captured since the last report — we don't try
to compute open/closed hours in software.

This means a business keeps its normal daytime workflow unchanged; it only forwards to FrontDesk
after hours.

## How the loop works

1. A forwarded call is answered and **saved normally** (browser test calls and Twilio phone calls
   both run through the same post-call core).
2. **Per-call SMS/email is OFF by default** (`delivery_mode = 'daily_digest'`). The per-call code
   still exists for the optional `instant_all` / `instant_action_needed` modes.
3. **Vercel Cron** hits `/api/cron/digest` hourly. For each business it sends the digest only when
   the **local hour ≥ the business's send hour** (default **8 AM** in the business timezone) and no
   digest has gone out for that local day yet.
4. The digest email contains: total calls, and per call — caller name, phone, request type,
   preferred date/time (if captured), short summary, suggested follow-up, and call time. A
   **CSV** with the same columns is attached when the owner's **Attach CSV** toggle is on
   (`agent_config.attach_csv`, default on); the email copy adapts when it's off.
5. Optional SMS says only: *"FrontDesk captured 6 after-hours calls. Report sent to your email."*
6. A `call_digests` row records the send (one per business per local day) so a digest is never sent
   twice and the next one only includes newer calls.

Demo calls are never saved, so they're never in a digest. A digest-delivery failure can't affect
saved calls (the cron is completely decoupled from the save path).

## Owner setup (in-app)

Dashboard → **Settings → After-hours report**: enable the email report (set a **Report email** or
leave blank to use the business email on file; **Attach CSV** is on by default), optionally enable
the SMS alert (a short, optional text — not required), and pick the **send hour**. Save.

The card shows a **domain-gated notice** until the production email sender is configured. The page
learns this from a read-only probe — `GET /api/notify-status` returns only `{ emailConfigured,
smsConfigured }` booleans (derived from `isEmailConfigured()`/`isSmsConfigured()`, never a key or
sender value). While `NOTIFY_EMAIL_FROM` is missing the notice stays up and the cron logs email as
`skipped`; reports can still be generated and SMS can still be tested. The notice clears itself
once a sender domain is configured.

**Probe auth:** `/api/notify-status` requires a **signed-in user** (same pattern as
`/api/billing/status` — the auth check uses the user's own cookie/RLS session via the anon key, no
service role). A signed-out or demo caller gets **401**, which the Settings page treats as "unknown"
and **keeps the no-domain notice up** (fail-safe) — so an anonymous visitor can't probe infra status
and the UI never implies email is ready.

## Deployment setup

### 1. Run the migration

Supabase SQL editor → `supabase/migrations/20260616000000_call_digests.sql`. Additive: adds
`calls.next_action` and the `call_digests` tracking table (RLS: members read their own; server
writes).

### 2. Environment variables (server-only)

```
CRON_SECRET=<generate one: openssl rand -hex 24>   # Vercel sends it as Authorization: Bearer …
SUPABASE_SERVICE_ROLE_KEY=…                          # cron reads businesses/calls + writes call_digests
RESEND_API_KEY=re_…                                  # email + CSV (see docs/call-delivery-setup.md)
NOTIFY_EMAIL_FROM=FrontDesk <alerts@yourdomain.com>
# Optional SMS alert (Twilio Programmable Messaging):
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_PHONE_NUMBER=+1…
NEXT_PUBLIC_SITE_URL=https://<your-domain>           # dashboard link in the email
```

If `CRON_SECRET` is unset the cron route refuses (never an open endpoint). If email/SMS provider
env is missing, that channel is logged as `skipped` and nothing breaks.

### 3. Cron schedule

`vercel.json` already declares the hourly cron:

```json
{ "crons": [{ "path": "/api/cron/digest", "schedule": "0 * * * *" }] }
```

**Plan note:** Vercel Hobby runs crons **once per day**; **hourly requires Vercel Pro**. On Hobby,
the digest still works but only fires at Vercel's single daily UTC time — set each pilot business's
`digest_send_hour` to match, or upgrade to Pro for true per-timezone morning delivery.

### 4. Manual test (before relying on the cron)

```bash
curl -X POST https://<your-domain>/api/cron/digest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Returns `{ ok, processed, sent }`. With a business whose local time is past its send hour, that has
captured calls today and the email toggle on, you should receive the report + CSV. Server logs show
`[FD] digest email (… ) → sent`.

## Honest limitations

- One report per business per local day; the cron only acts at/after the send hour.
- Vercel Hobby = daily cron only (see plan note above).
- No retry queue: a failed send is logged with status `failed` on the `call_digests` row, not
  retried (calls remain safely saved).
- Per-call instant modes exist but are off by default and intentionally not surfaced in the MVP UI.
