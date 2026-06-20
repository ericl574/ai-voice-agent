# First Pilot Customer — Setup & Operations Checklist

Eric's runbook for onboarding the first real business. Work top to bottom; everything here is
manual on purpose — automate later, after the process has been run at least once for real.

## 0. Before approaching any pilot business (one-time)

- [ ] Replace the placeholders in `src/lib/site.ts`:
  - `SUPPORT_EMAIL` — a real, monitored inbox.
  - `OPERATOR_NAME` — the legal operator identity for the Privacy/Terms pages.
- [ ] Have a lawyer review `/privacy` and `/terms` (BC PIPA / PIPEDA; call transcripts are
  personal information; processing happens on US servers via OpenAI/Supabase/Vercel).
- [ ] Set `NEXT_PUBLIC_SITE_URL` on Vercel to the production domain.
- [ ] Add the production domain to the Supabase Auth **redirect URL allowlist** and point the
  recovery email template at `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update`.
- [ ] Run the manual voice QA pass (`docs/manual-voice-qa.md`) on the deployed build.
- [ ] Set an OpenAI **usage limit / budget alert** on the API key used in production.
- [ ] Verify `npm run build`, `qa:units`, `qa:call-pipeline` pass on the deploy commit.

## 1. Smoke test on production (every deploy that precedes a pilot demo)

- [ ] Landing page loads; hero video plays; footer Privacy/Terms/Contact links work.
- [ ] "Try Our Service" live demo connects, speaks, and ends cleanly (one vertical is enough).
- [ ] `View Demo` dashboard works signed-out; demo banner shows; no real data visible.
- [ ] Sign-up → onboarding → dashboard flow works with a throwaway account.
- [ ] Password reset email arrives and the link works.
- [ ] Signed-in test call on `/dashboard/voice`: call runs, saves, transcript appears in Call
  History, extraction creates the expected appointment/service request.

## 2. Onboarding the pilot business (do it with them, ~45 min)

- [ ] Create their account together (their email; they set the password).
- [ ] Onboarding: correct business type (drives the vertical), name, phone, city,
  **timezone** (critical — drives "today/tomorrow" on calls), front desk name + greeting.
- [ ] Settings: business hours, walk-in policy, callback expectation, escalation rule, tone,
  voice + speed (play the preview for them).
- [ ] Settings → **After-hours report** (the main deliverable): enable the daily email report, set
  the report email (and optionally the SMS alert + number), pick the send hour. If the sender domain
  isn't configured yet, the card shows a domain-gated notice — that's expected; SMS still tests and
  reports still generate (`docs/after-hours-report.md`).
- [ ] Knowledge base: enter their top ~10 caller questions (hours, prices/policy, services,
  parking, cancellation policy...). Use their words — the front desk answers from this only.
- [ ] Reservation confirmation mode: keep **staff-confirm** for the pilot (auto mode's SMS
  sender is stubbed; the confirm link only appears in the dashboard).
- [ ] Place 3–5 realistic test calls with them on `/dashboard/voice` (a booking, a price
  question, something not in the KB, an end-call). Show how each lands in the dashboard.
- [ ] Walk through the staff loop: Overview → priority actions → confirm/decline → call history.
- [ ] Set expectations explicitly: the value is **one daily report** of the calls FrontDesk captured
  (the dashboard is history/settings, not daily software to monitor); browser-based test line (no
  real phone number yet); requests are pending until staff confirms; transcripts are stored and
  deletable on request.

## 3. During the pilot (weekly)

- [ ] Check Vercel logs for `[FD]` errors (post-call failures, rate-limit warnings).
- [ ] Review a sample of their call transcripts *with permission* for quality issues.
- [ ] Ask: any call that embarrassed you? any detail captured wrong? anything staff ignored?
- [ ] Watch OpenAI usage against the budget alert.

## 4. Data deletion SOP (until an in-app flow exists)

On request from the business (email to the support inbox):

1. Confirm the requester owns the account (email must match the `business_members` owner).
2. In Supabase (dashboard, RLS-respecting service access): delete rows for that `business_id`
   in `call_messages` → `calls` → `appointments` → `service_requests` → `business_knowledge` →
   `business_members` → `businesses`, then delete the auth user.
3. Reply confirming completion and date. Target: within 30 days (promised in the Privacy Policy).
4. For a single-call deletion, delete just that `calls` row + its `call_messages` + any linked
   appointment/service request.

## 5. Known limitations to disclose honestly

- Browser test line only — no real phone number yet (that's the next phase, with its own consent
  and disclosure work).
- Reservation auto-confirm SMS is stubbed; staff-confirm mode is the supported flow.
- Background competing speech can clear assistant audio mid-reply (documented in
  `docs/call-pipeline.md` §2; deferred VAD/playback work).
- No error monitoring yet — issues surface via logs and user reports.
