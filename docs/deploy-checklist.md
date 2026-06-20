# Deploy Checklist — Tomorrow Morning Runbook

Ordered so each step is testable before the next. Stripe and Twilio are independent — do either
first. Detailed guides: `docs/stripe-setup.md`, `docs/twilio-setup.md`, `docs/pilot-checklist.md`.

## A. Base deploy (15 min)

- [ ] Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `OPENAI_API_KEY`, `NEXT_PUBLIC_SITE_URL=https://<domain>`.
- [ ] Supabase Auth → URL configuration: add the domain to the redirect allowlist; point the
      recovery email template at
      `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update`.
- [ ] Deploy. Smoke: landing loads · "Try Our Service" live demo speaks · `View Demo` dashboard
      works signed-out · sign-in + dashboard test call works · `/pricing`, `/privacy`, `/terms`,
      `/contact` load · bad URL shows the branded 404.
- [ ] Replace placeholders in `src/lib/site.ts` (`SUPPORT_EMAIL`, `OPERATOR_NAME`) when decided.

## B. Stripe test subscription (20 min) — `docs/stripe-setup.md`

> **Optional, not the reporting-MVP focus.** Billing is **test-mode scaffolding** (plan status is
> stored/displayed, **not enforced** — see §E). The current MVP is missed-call capture + the daily
> report; skip this section unless Eric is explicitly working the billing phase.

- [ ] Supabase: run `supabase/migrations/20260611000000_billing_subscriptions.sql`.
- [ ] Stripe test mode: create Starter + Pro products/prices; webhook endpoint
      `https://<domain>/api/billing/webhook` (5 events listed in the guide).
- [ ] Vercel env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`,
      `STRIPE_PRICE_PRO`, `SUPABASE_SERVICE_ROLE_KEY`. Redeploy.
- [ ] Acceptance: checkout with `4242…` test card → settings shows "Starter · Active" →
      Manage billing opens the portal → webhook deliveries are 200.

## C. Twilio real phone call (30 min) — `docs/twilio-setup.md`

- [ ] Supabase: run `supabase/migrations/20260611000001_calls_source.sql` (optional, recommended).
- [ ] Twilio: account + voice number; "A call comes in" → `https://<domain>/api/twilio/voice`.
- [ ] Local: `npm run twilio:bridge` + `ngrok http 8787`.
- [ ] Vercel env: `TWILIO_AUTH_TOKEN`, `TWILIO_STREAM_URL=wss://<ngrok>/twilio-stream`,
      `TWILIO_BRIDGE_SECRET` (same value in `.env.local` for the bridge), `TWILIO_BUSINESS_ID`,
      `SUPABASE_SERVICE_ROLE_KEY`. Redeploy.
- [ ] Acceptance: call the number from your phone → disclosure → FrontDesk answers → book
      something → hang up → call + transcript + appointment appear in the dashboard.

## D. Watchpoints

- OpenAI usage budget alert (phone calls consume Realtime audio tokens).
- Stripe webhook delivery failures (Stripe dashboard shows retries).
- Bridge terminal output during the first calls (`session ready`, `post-call → 200`).
- Free-ngrok URL changes on restart → update `TWILIO_STREAM_URL`.

## E. Known limitations (do not promise these yet)

- One Twilio number → one business (env-mapped). No per-business numbers yet. SMS is limited to the
  **optional after-hours report alert** (`docs/after-hours-report.md`), not per-call texting.
- Plan status is stored/displayed, not enforced (no feature gating).
- Bridge must move to an always-on host (Railway/Render/Fly) before any pilot relies on it.
