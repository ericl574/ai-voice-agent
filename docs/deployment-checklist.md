# FrontDesk Deployment Checklist (first pilot)

Canonical, ordered deployment path. Deep references: **`docs/twilio-setup.md`** (Twilio + bridge,
step-by-step), `docs/call-forwarding-setup.md` (merchant forwarding + the real acceptance test),
`docs/after-hours-report.md`, `docs/supabase-rls-verification.md`.
This page is the index + the env matrix; it does not replace those.

> Nothing here is auto-applied — every item needs Eric's own account/dashboard action. Where setup is
> external, that is stated plainly rather than pretended done.

## The two runtimes (on purpose)
- **Next app → Vercel** (serverless): pages, API routes, save, extraction, the morning-report cron.
- **Bridge → a durable Node host** (`server/twilio-bridge.ts`): Twilio Media Streams need a persistent
  WebSocket, which Vercel serverless cannot host. Use **ngrok** for the first test call, **Railway/
  Render/Fly** for the pilot. Start command: `npm run twilio:bridge`, health path `/health`.

## Before outreach — identity & legal (one-time)
- Set the real operator identity in `src/lib/site.ts`: `OPERATOR_NAME`, `SUPPORT_EMAIL` (a monitored
  inbox — a personal Gmail is acceptable for a supervised first pilot; move to a domain address before
  broader launch), `OPERATOR_JURISDICTION`, `LEGAL_LAST_UPDATED`. These render on `/privacy` + `/terms`.
- Have a lawyer skim `/privacy` + `/terms` (PIPEDA / BC PIPA — **call transcripts are personal
  information**, processed on US servers via OpenAI/Supabase/Vercel). The pages already cover recording,
  retention, subprocessors, and deletion-on-request.

## Order of operations
1. **Supabase** — run the 6 migrations in `supabase/migrations/`, then **verify RLS**
   (`docs/supabase-rls-verification.md` — this is the hard gate). Also configure **Auth → URL
   Configuration**: add the production domain to the redirect allowlist, and point the recovery email
   template at `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update`
   (otherwise password reset links break).
2. **OpenAI** — one API key; set on **both** the app and the bridge (see matrix). Realtime model `gpt-realtime`.
3. **Vercel** — deploy the app; set env (matrix); `NEXT_PUBLIC_SITE_URL` must equal the Twilio webhook origin.
4. **Bridge host** — deploy the bridge; set env; note its `wss://<host>/twilio-stream` URL.
5. **Twilio** — provision a Voice number as the business's **hidden forwarding destination** (never the
   merchant's public number); point "A call comes in" → `https://<app>/api/twilio/voice` (POST); map it by
   setting `businesses.twilio_number` (E.164). The merchant then forwards their **after-hours** calls to it
   (`docs/call-forwarding-setup.md`).
6. **Email report (optional for go-live)** — Resend API key + a **verified sender domain**
   (`NOTIFY_EMAIL_FROM`). Until the domain is verified, email **skips safely** and Settings shows the
   domain notice — SMS + dashboard still work. Do not claim email is live before the domain is verified.
7. **Cron** — `vercel.json` already schedules `/api/cron/digest`. **Note:** Vercel Hobby = **one** run/day
   at `0 13 * * *`; set each pilot's `digest_send_hour` at/before that tick, or upgrade to Pro for hourly.
8. **Monitoring** — set `OPS_ALERT_SMS_TO` (+ `TWILIO_ACCOUNT_SID`/`TWILIO_PHONE_NUMBER`) so failed
   saves/extractions/digests and low-quality calls page you by SMS. Watch bridge logs during the pilot.
9. **Acceptance** — do one **real forwarded-call acceptance test** (`docs/call-forwarding-setup.md`: a
   forwarded after-hours call answers as the right business + caller-ID survives) and one browser test call
   before pointing a customer at it.

## Environment variable matrix
| Var | App (Vercel) | Bridge | Purpose |
|---|:---:|:---:|---|
| `OPENAI_API_KEY` | ✅ | ✅ | app = post-call analysis; bridge = the live voice. **Both** or the report says "analysis pending". |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase client/auth |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | save phone calls, load business prompt, routing, leads, digest. **Server-only.** |
| `NEXT_PUBLIC_SITE_URL` | ✅ | — | must equal the Twilio webhook origin (signature check) |
| `TWILIO_AUTH_TOKEN` | ✅ | — | verify inbound webhook signature |
| `TWILIO_STREAM_URL` | ✅ | — | `wss://<bridge-host>/twilio-stream` |
| `TWILIO_BRIDGE_SECRET` | ✅ | ✅ | shared secret for session-config + post-call |
| `FD_APP_URL` | — | ✅ | the Vercel origin the bridge calls back to |
| `TWILIO_BUSINESS_ID` | (dev only) | — | **Local/dev/test pin — IGNORED in production** (`pinForEnv`). Production inbound routing is **always** `To → businesses.twilio_number`; an unmapped number **fails closed** (neutral hangup, no demo, no save). Setting it in prod has no effect. |
| `CRON_SECRET` | ✅ | — | guards `/api/cron/digest` |
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | ✅ | — | morning report email + CSV (domain-gated) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_PHONE_NUMBER` | ✅ | — | optional SMS alert + ops alerts |
| `OPS_ALERT_SMS_TO` | ✅ | — | operator phone for failure alerts |

**Secret hygiene:** never commit real values; `.env.local`/`.env*` stay out of git; the browser only
ever receives an ephemeral OpenAI client secret (from `/api/voice-session`), never the raw key.
Changing an env var on Vercel requires a **redeploy** to take effect.

## Rollback plan (pilot)
- **Turn the line off fast:** in Twilio, repoint the number's webhook away (or release it) — inbound
  calls immediately stop hitting FrontDesk. The bridge can also be stopped on its host.
- **App:** Vercel → Deployments → promote the previous good deployment.
- **Data:** calls are additive; nothing auto-deletes. Do not run destructive SQL to "undo" a pilot.
- **If the agent misbehaves on a call:** stop the bridge / repoint Twilio, then review the saved
  transcript in Call History and adjust the business's Knowledge Base / greeting before re-enabling.

## Verify saved data (read-only SQL, Supabase editor)
Quick sanity checks that the capture loop persisted correctly (safe to run anytime):
```sql
-- recent saved calls (transcript/summary/details/follow-up)
select id, business_id, intent, customer_name, customer_phone, summary, next_action, created_at
  from calls order by created_at desc limit 5;

-- per-business report settings (toggles live in agent_config JSONB)
select id, name, email,
       agent_config->>'notify_email'     as notify_email,
       agent_config->>'notify_sms'       as notify_sms,
       agent_config->>'digest_send_hour' as send_hour
  from businesses;

-- digest results after a cron run
select business_id, digest_date, call_count, email_status, sms_status, sent_at
  from call_digests order by sent_at desc limit 5;
```

## Deploy checklist
- [ ] Migrations run; **RLS verified** (`docs/supabase-rls-verification.md`).
- [ ] App deployed to Vercel with full env; `NEXT_PUBLIC_SITE_URL` = webhook origin.
- [ ] Bridge deployed to a durable host; `/health` returns ok.
- [ ] `OPENAI_API_KEY` set on **both** app and bridge.
- [ ] Twilio number webhook → `/api/twilio/voice`; `businesses.twilio_number` mapped.
- [ ] `OPS_ALERT_SMS_TO` set for failure alerts.
- [ ] One real phone acceptance call + one browser test call pass.
- [ ] (If using email) Resend domain verified; otherwise pilot on dashboard + CSV and say so.
