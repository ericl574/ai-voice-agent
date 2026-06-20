# FrontDesk — MVP Activation Runbook

A practical checklist to get FrontDesk usable end-to-end and to prove each flow works. Written for
the current state: **after-hours / missed-call capture**, daily report deliverable, **no verified
sender domain yet** (email intentionally in no-domain mode). See also `docs/after-hours-report.md`,
`docs/twilio-setup.md`, `docs/call-delivery-setup.md`.

> Source-of-truth note: this runbook is operational. Product framing lives in `CLAUDE.md` /
> `docs/product-scope.md`; the code paths are unchanged by it.

---

## 1. Current MVP definition

FrontDesk answers the calls a business was already missing (after hours / no-answer / busy),
**captures the caller's request**, **saves the call** (transcript + summary + details), and notifies
the owner. The owner's deliverable is **one daily report**:

- **Email summary + CSV is the primary report.** **SMS is an optional short alert.**
- The dashboard is secondary (settings / call history / report archive).

The **browser voice test** (`/dashboard/voice`, signed in) is the working test surface today. Real
inbound phone calls are **code-complete but not yet activated** (needs Twilio + a hosted bridge).

---

## 2. What works WITHOUT a domain (today)

- ✅ Signed-in **browser voice test** call → answers naturally.
- ✅ **Call saving** (`calls` + `call_messages`) scoped to the business.
- ✅ **Transcript / summary / details** + `calls.next_action` (post-call extraction).
- ✅ **Appointment / service-request** rows created when the caller intends one.
- ✅ **SMS alert** (Twilio) — testable now via Settings → After-hours report → **Send test SMS**,
  and via the daily digest.
- ✅ **Daily digest** (`/api/cron/digest`) — writes a `call_digests` row; **email skips safely**,
  **SMS sends**, cron returns 200, never crashes.
- ✅ **Demo mode** — isolated, never persists real data.

## 3. What REQUIRES a domain (later)

- ❌ **Production email report + CSV.** `sendEmail()` (Resend) only sends when both `RESEND_API_KEY`
  **and** `NOTIFY_EMAIL_FROM` are set. With `NOTIFY_EMAIL_FROM` missing, `isEmailConfigured()` is
  false → the digest records `email_status = skipped` (no crash). After Eric verifies a domain in
  Resend and sets `NOTIFY_EMAIL_FROM`, email becomes `sent`. **No code change needed** — env only.

Also separate from a domain (its own activation): **real inbound phone calls** — see §10.

---

## 4. Required env vars by flow (server-side only; never commit `.env.*`)

| Flow | Required env | Present on Vercel today? |
| ---- | ------------ | ------------------------ |
| **Browser test** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`, `NEXT_PUBLIC_SITE_URL` | ✅ yes |
| **Call saving / extraction** | above + `OPENAI_API_KEY` (extraction) | ✅ yes |
| **SMS alert** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | ✅ yes |
| **Email report** | `RESEND_API_KEY` **+ `NOTIFY_EMAIL_FROM`** | ⚠️ `NOTIFY_EMAIL_FROM` intentionally missing |
| **Daily digest cron** | `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (+ SMS/email env per channel) | ✅ yes |
| **Real inbound phone** | `TWILIO_AUTH_TOKEN`, `TWILIO_STREAM_URL`, `TWILIO_BRIDGE_SECRET`, `TWILIO_BUSINESS_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` | ❌ stream URL / bridge secret / business id not set; bridge not hosted |
| **Bridge process** (separate host) | `OPENAI_API_KEY`, `TWILIO_BRIDGE_SECRET`, `FD_APP_URL` | ❌ not running yet |

`NOTIFY_EMAIL_FROM` format when ready: `FrontDesk <alerts@yourdomain.com>` (must be a Resend-verified domain).

---

## 5. Twilio setup steps (for real inbound calls + SMS)

SMS (already usable today): the account is configured; on a **trial**, SMS can only go to **verified**
numbers and carries a trial prefix. Add Eric's mobile under Twilio Console → Phone Numbers → Verified
Caller IDs to test.

Real inbound calls (not yet activated):
1. Twilio Console → buy a **Voice-capable** number.
2. Phone Numbers → your number → Voice → **A call comes in** → Webhook
   `https://<your-domain>/api/twilio/voice`, **HTTP POST**.
3. Run the **bridge** (`server/twilio-bridge.ts`) somewhere durable — **not Vercel** (serverless
   can't host a durable WebSocket). For a test: `npm run twilio:bridge` + `ngrok http 8787`. For
   production: Railway / Render / Fly (any always-on Node host).
4. Set `TWILIO_STREAM_URL=wss://<bridge-host>/twilio-stream` in Vercel; set `TWILIO_BRIDGE_SECRET`
   (same value in Vercel and the bridge env); set `TWILIO_BUSINESS_ID` to the business that should
   answer; ensure `SUPABASE_SERVICE_ROLE_KEY` is set. Redeploy.
5. Full guide: `docs/twilio-setup.md`.

---

## 6. Vercel setup steps

1. Confirm env (see §4). For email later, add `NOTIFY_EMAIL_FROM` and redeploy.
2. **Cron is declared** in `vercel.json` (`/api/cron/digest`, **`0 13 * * *`** — once daily, 13:00
   UTC ≈ early-morning Pacific). **Plan note:** Vercel **Hobby supports one daily cron only** — an
   hourly schedule (`0 * * * *`) makes the deployment **fail to build** on Hobby (this once pinned
   production to an old commit). The MVP doesn't need hourly: the route checks `digest_send_hour` and
   dedupes per business/day, so one daily tick is enough — set each business's `digest_send_hour`
   at/before it. **Manual `curl` (below) works on any plan** for testing. Hourly / true per-timezone
   delivery needs **Vercel Pro** (or an external scheduler) — defer until needed.
3. After changing any env var, **redeploy** (env changes don't apply to existing deployments).

---

## 7. Supabase verification queries

```sql
-- Migrations present (next_action column + call_digests table)?
select column_name from information_schema.columns
  where table_name = 'calls' and column_name = 'next_action';

-- Recent saved calls (transcript/summary/details/follow-up)
select id, business_id, intent, customer_name, customer_phone, summary, next_action, created_at
  from calls order by created_at desc limit 5;

-- Business report settings (toggles live in agent_config JSONB)
select id, name, phone, email,
       agent_config->>'notify_email'    as notify_email,
       agent_config->>'notify_sms'      as notify_sms,
       agent_config->>'notify_sms_to'   as sms_to,
       agent_config->>'attach_csv'      as attach_csv,
       agent_config->>'digest_send_hour' as send_hour
  from businesses;

-- Digest results (after a cron run)
select business_id, digest_date, call_count, email_status, sms_status, sent_at
  from call_digests order by sent_at desc limit 5;
```

---

## 8. Manual test A — browser-only, no-domain MVP test

1. Sign in → `/dashboard/voice`.
2. Make **2–3 test calls** (book something, ask a question, end the call).
3. `/dashboard/calls`: confirm each call shows with **transcript + summary**; appointments/service
   requests appear in their tabs.
4. Supabase: run the "recent saved calls" query — confirm `summary` and `next_action` populated.
5. (No email/SMS needed.) **Expected:** calls captured and saved; this is the core MVP value working
   without a domain.

## 9. Manual test B — SMS alert test

**Quick (isolated):**
1. Settings → **After-hours report** → enable **Text me when the report is ready**, set the **SMS
   alert number** to a Twilio-**verified** number, **Save**.
2. Click **Send test SMS**. Expected inline: "Test SMS sent to ••••XXXX." A text arrives (trial
   prefix on a trial account). Reasons if not: `sms_not_configured` (Twilio env), `no_destination`
   (save a number first).

**Via the digest (end-to-end):**
1. Do Test A first (so there are captured calls today).
2. Settings: enable SMS + set **Send report at → 12 AM** (so local hour ≥ send hour always), Save.
3. Trigger the cron (see Test below). Expected: an SMS "FrontDesk captured N after-hours calls…",
   and a `call_digests` row with `sms_status = sent`, `email_status = skipped`.

Cron trigger:
```bash
curl -i -X POST "https://<your-domain>/api/cron/digest" -H "Authorization: Bearer <CRON_SECRET>"
# → HTTP 200  {"ok":true,"processed":N,"sent":M}
```

## 10. Manual test C — real inbound phone call

Prereq: §5 done (number webhook set, bridge running/hosted, env set, redeployed).
1. Bridge up (`npm run twilio:bridge` + `ngrok`, or hosted); `TWILIO_STREAM_URL` matches the
   bridge's public wss URL; `TWILIO_BUSINESS_ID` set.
2. Call the Twilio number. Expect: disclosure → FrontDesk greeting → a normal booking conversation.
3. Bridge logs: `stream started` → `session ready` → on hangup `post-call → 200`.
4. `/dashboard/calls`: the phone call (transcript + summary) appears; appointment/service request if
   relevant. (Demo-fallback calls with no `TWILIO_BUSINESS_ID` are **not** saved — by design.)

> Honest status: this path is code-complete and OpenAI-verified against a simulated stream, but has
> **not** been exercised by a real Twilio call. Expect possible small first-call fixes (trial
> notices, regional codecs). Do not promise production phone service before this test passes.

## 11. Manual test D — email report after a domain is added

1. Verify a domain in Resend; set `NOTIFY_EMAIL_FROM=FrontDesk <alerts@yourdomain.com>` in Vercel;
   redeploy.
2. Settings → After-hours report: the **domain-gated notice disappears** (the page's
   `/api/notify-status` probe now reports `emailConfigured: true`). Enable **Send daily report**, set
   **Report email**, keep **Attach CSV** on, Save.
3. Do Test A (capture calls today), set send hour to 12 AM, trigger the cron.
4. Expected: an email report **with CSV attached** arrives; `call_digests` row shows
   `email_status = sent`.

---

## 12. Current blockers

| # | Blocker | Type | Impact |
| - | ------- | ---- | ------ |
| 1 | `NOTIFY_EMAIL_FROM` missing (no verified domain) | External (intentional) | Production email report not sent (skips safely). Everything else works. |
| 2 | Real inbound phone not activated: bridge not hosted; `TWILIO_STREAM_URL` / `TWILIO_BRIDGE_SECRET` / `TWILIO_BUSINESS_ID` unset; number webhook not pointed | External / ops | Can't take real phone calls yet. Browser test is the surface meanwhile. |
| 3 | Twilio account may be **trial** | External | SMS only to verified numbers; trial call notice. Fine for testing. |
| 4 | Vercel plan (if Hobby) = one daily cron only (`0 13 * * *`) | External / plan | Digest fires once/day; an hourly cron would fail the build on Hobby. Use manual `curl`, set `digest_send_hour` to match, or upgrade to Pro. |

**No code blockers** were found in the capture/save/SMS/digest/email paths. The only code change in
this activation pass is the **Send test SMS** path (new `POST /api/notify-test-sms` + a Settings
button) so SMS can be verified directly.

## 13. Exact next action for Eric

1. **Today, no domain:** run **Test A** (browser capture) and **Test B quick** (Send test SMS to a
   verified number). This proves capture + save + SMS — the testable MVP.
2. **When ready for the report email:** buy/verify a domain in Resend → set `NOTIFY_EMAIL_FROM` →
   redeploy → run **Test D**.
3. **When ready for real phone:** follow §5 (number webhook + host the bridge + set the three Twilio
   env vars) → run **Test C**. Start with Mac + ngrok; move the bridge to Railway/Render/Fly before a
   pilot relies on it.
