# FrontDesk — Production Tasks (first customer)

Priority: **P0** must finish before the first customer · **P1** important, shortly after pilot ·
**P2** nice-to-have. Status: `[x]` done+verified · `[EXTERNAL]` needs Eric's dashboard/DB/phone (not
code) · `[ ]` open. Evidence: `reports/production-readiness-report.md`.

## P0 — before first customer
- [x] **Harden tenant isolation in code.** `getActiveBusiness()` now scopes `business_members` by the
  signed-in `user_id` (not RLS-only) — `src/lib/supabase/businesses.ts`. Guard test in `qa:units`. ✅ this run.
- [ ] [EXTERNAL] **Verify/complete Supabase RLS** on every business-data table (`docs/supabase-rls-verification.md`).
  The code fix above protects the read-side active-business lookup, but **write paths and other tables
  still depend on RLS** — this remains the #1 gate. **RLS correctness is NOT VERIFIED from the repo.**
- [ ] [EXTERNAL] **One real phone acceptance call** end-to-end (`docs/pilot-go-live.md` §5). The phone
  path is code-complete but **NOT VERIFIED on a live call.**
- [ ] [EXTERNAL] **Deploy**: Vercel app + durable bridge host + full env matrix + Twilio number →
  `businesses.twilio_number` mapping (`docs/deployment-checklist.md`).
- [ ] [EXTERNAL] **Set `OPENAI_API_KEY` on BOTH app and bridge**, `OPS_ALERT_SMS_TO`, and an OpenAI
  usage/budget alert (missing app key → "analysis pending" reports; missing ops alert → silent failures).
- [ ] **Commit a baseline schema migration** (recommended) so schema + RLS are reproducible
  (`docs/supabase-rls-verification.md` Step 3). Requires a schema export from Eric.

## P1 — shortly after pilot
- [ ] In-app **data-deletion** flow (replace the manual SOP in `docs/first-customer-onboarding.md`).
- [ ] Run **live conversational eval** (`npm run qa:agent-evals`, needs a key) before/after prompt
  changes; wire into CI once a CI key exists. Catches agent regressions.
- [ ] **`global-error.tsx`** boundary (root-layout errors) + basic uptime/error monitoring beyond ops SMS.
- [ ] Move **rate-limiting to a shared store** (Upstash/Redis) — the in-memory limiter is per-instance,
  so the paid-session-minting cap is bypassable across Vercel instances (`src/lib/rate-limit.ts`).
- [ ] **Mobile device QA** pass (responsive markup exists; NOT VERIFIED on a real device).

## P2 — nice-to-have
- [ ] **Native SDK specialist handoffs + live tools** — migrate the modular specialists
  (`docs/agent-specialists.md`) to `@openai/agents` `RealtimeAgent` handoffs + mid-call function-calling
  wired into both transports. Deferred deliberately; pilot uses prompt-composed specialists + post-call
  server functions.
- [ ] **Surface `calls.analysis`** (booking_status / confidence / risk_flags / staff_summary) in the
  dashboard Call History + Overview. Data is captured now; UI is a follow-up.
- [ ] Bridge **horizontal scale / failover** (single Node process today).
- [ ] Consolidate **duplicate WebRTC clients** + demo fixtures (`docs/demo-architecture-debt.md`).
- [ ] Decide on **Stripe billing**: finish enforcement or remove the unused scaffolding.
- [ ] **KB retrieval** for large knowledge bases (currently whole-KB prompt injection).
