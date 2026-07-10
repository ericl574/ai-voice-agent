# FrontDesk — Production Readiness Report (first customer)

_Brutally honest. Every claim is marked **[verified]** (read in code / passing tests this session) or
**[NOT VERIFIED]** (needs a live env, DB, phone, or device). Diagnostic — nothing was faked._

---

## 1. What already works

- **Landing / pricing / contact** — real, honest copy; pilot CTA + working `/contact` form with durable
  lead storage (`pilot_requests`, service-role insert). **[verified read + tests]**
- **Auth model** — signed-out `/dashboard` resolves to demo/mock data; real data loads only for a
  signed-in, non-demo user; no-business → redirect to `/onboarding` (`src/app/dashboard/layout.tsx`).
  **[verified]**
- **Tenant isolation (read side)** — `getActiveBusiness()` now filters `business_members` by the
  signed-in `user_id` (hardened this run; guard-tested). **[verified]**
- **Onboarding** — business profile create + "set up later" (`src/app/onboarding/page.tsx`). **[verified read]**
- **Browser voice test call** — real call, Layer-2 orchestration, saves; reliability hardened this
  session (transient-disconnect grace). **[verified read + this session's work]**
- **Capture loop** — transcript (`buildTranscript`), summary + appointment/service-request creation via
  shared `runPostCallExtraction` (`postCallCore.ts`); items land **pending**. **[verified read + tests]**
- **Call History** — two-sided transcript (Front desk / Caller), summary, Follow-up flag
  (`src/app/dashboard/calls/page.tsx`). **[verified read]**
- **Demo vs real separation** — one server-resolved source of truth; demo never persists. **[verified]**
- **API/auth guards** — `voice-session` (auth-or-demo + rate-limit), `cron/digest` (CRON_SECRET,
  timing-safe), `twilio/*` (bridge secret + Twilio signature), `notify-test-sms` (auth + rate-limit),
  `pilot-request` (rate-limit + validation). **[verified read]**
- **Legal** — Privacy (recording, caller data, retention, subprocessors) + Terms (AI, "not a human",
  liability, pilot). **[verified via content grep]**
- **Observability** — per-call quality metric + ops SMS alerts (failed save/extraction/digest,
  low-quality call, fallback-instructions). **[verified this session]**
- **Tests/build** — `qa:units` **120 ✓**, `qa:call-pipeline` **46 ✓**, `next build` ✓, `tsc --noEmit` ✓.
  **[verified this run]**

## 2. What is partially working

- **Real phone (Twilio) path** — code-complete + hardened (server auto-response, safety caps, one-shot
  OpenAI reconnect), but **thinner than the browser path** (no Layer-2 gating) and **[NOT VERIFIED on a
  real call]**.
- **Morning report email** — generation + CSV work, but **domain-gated**: email skips until a Resend
  sender domain (`NOTIFY_EMAIL_FROM`) is verified. Dashboard + CSV work meanwhile. **[verified logic; email delivery NOT VERIFIED]**
- **Error handling** — global `error.tsx` + `not-found.tsx` exist; **no `global-error.tsx`** (root-layout
  failures). **[verified files; full coverage partial]**
- **Mobile** — responsive Tailwind + a mobile drawer (`DashboardShell`); **[NOT VERIFIED on a device]**.
- **Reservation auto-confirm SMS** — **stubbed**; staff-confirm is the supported flow. **[verified]**

## 3. What is missing

- **Base DB schema + RLS policies in version control** — not in `supabase/migrations/`. The reservation
  confirm/deletion **Postgres RPCs** (`get_reservation_for_confirmation`, `confirm_reservation`) are also
  DB-only + unversioned. **[verified absence]**
- **In-app data-deletion flow** — currently a manual support SOP (`docs/first-customer-onboarding.md`).
- **Live conversational eval in CI** — harness exists (`scripts/qa-agent-evals.ts`) but needs a key; not wired to CI.
- **e2e / integration / React component tests** — none; only pure-helper units.
- **Uptime/error monitoring** beyond ops SMS.

## 4. What is broken or risky

- **RLS correctness is UNVERIFIABLE from the repo** — HIGH. The read-side active-business lookup is now
  hardened in code, but **write paths and other tables still depend on RLS**. Must be confirmed in
  Supabase before a second tenant exists. **[NOT VERIFIED]**
- **In-memory rate limiter is per-instance** (`src/lib/rate-limit.ts`) — HIGH. On Vercel's many
  instances, the cap on minting **paid** OpenAI Realtime sessions is largely bypassable → cost abuse. **[verified code]**
- **Single-process bridge** — no scale/failover (`server/twilio-bridge.ts`); fine for pilot volume, a
  single point of failure beyond it. **[verified]**
- **Vercel Hobby cron once/day** (`0 13 * * *`) vs per-business `digest_send_hour` — some businesses could
  miss reports unless send hour ≤ the tick. **[verified vercel.json + code]**

## 5. What is required before first customer (P0)

1. **Confirm/complete Supabase RLS** (`docs/supabase-rls-verification.md`) — the #1 gate. **[EXTERNAL]**
2. **One real phone acceptance call** (`docs/pilot-go-live.md` §5). **[EXTERNAL]**
3. **Deploy** — Vercel + bridge host + env matrix + Twilio number → `businesses.twilio_number`
   (`docs/deployment-checklist.md`). **[EXTERNAL]**
4. `OPENAI_API_KEY` on **both** app + bridge; `OPS_ALERT_SMS_TO`; OpenAI budget alert. **[EXTERNAL]**
5. (Recommended) commit a baseline schema migration.

## 6. What can wait until after first customer (P1/P2)

In-app data deletion; live eval in CI; `global-error.tsx` + uptime monitoring; shared-store rate
limiting; mobile device QA; bridge horizontal scale; dedupe the two WebRTC clients; Stripe decision;
KB retrieval. (Full list in `PRODUCTION_TASKS.md`.)

## 7. Biggest technical risks

1. **RLS / tenant isolation** — partially mitigated in code this run; write-side still RLS-dependent and unverified.
2. **Real phone path unproven** on a live call.
3. **Single points of failure** — one bridge process; in-memory rate limiter.

## 8. Biggest product / customer-trust risks

1. **An embarrassing call** in front of the customer's caller — the phone path is thinner and the live
   eval hasn't been run; do the acceptance call + a few scripted test calls first.
2. **Content-free reports** ("analysis pending") if the app is missing `OPENAI_API_KEY` — mitigated by a
   loud ops alert, not prevented.
3. **Over-promising** — must not claim "confirmed" bookings (they're pending), the email report before a
   domain is verified, or receptionist replacement (it's after-hours/missed-call capture).

---

_Next task: verify Supabase RLS (`docs/supabase-rls-verification.md`) — the single gate from ALMOST
READY → READY, only doable by Eric with DB access._
