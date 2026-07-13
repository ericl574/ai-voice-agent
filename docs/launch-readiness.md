# FrontDesk — Launch Readiness (what's blocking a full publish)

Single source of truth for "what stands between the current code and a real launch." Replaces the
old scattered status files (`STATUS.md`, `PRODUCTION_GOAL/TASKS.md`, `report.md`,
`reports/production-readiness-report.md`). **Honest by rule:** every claim is either **[verified]**
(read in code / passing tests) or **[EXTERNAL]** (needs Eric's Supabase/Twilio/Vercel/phone — not code).

## Readiness levels (the current framing — read this first)

FrontDesk readiness is defined in three explicit levels. **Current execution target: Level 1.**
Next: **Level 2.** Long-term: **Full Level.**

- **Level 1 — one real customer can use FrontDesk.** Eric manually creates/configures the business,
  prepares the merchant-specific Agent + knowledge, buys/selects + maps the hidden Twilio number,
  helps the merchant enable forwarding, collects payment, and handles support/deletion by hand.
  **Level 1 is complete ONLY when a REAL forwarded call succeeds end-to-end:** merchant's existing
  public number → real carrier/PBX forwarding → dedicated hidden Twilio number → production
  `/api/twilio/voice` → inbound `To` matched to `businesses.twilio_number` → correct merchant-specific
  Agent → real conversation → saved call + two-sided transcript + extracted result. **Automated tests
  alone do NOT complete Level 1** — it requires real forwarded-call evidence (acceptance test in
  `docs/call-forwarding-setup.md`).

- **Level 2 — operator-assisted ~5-minute activation.** Eric still participates, but FrontDesk provides
  a fast, repeatable workflow: website URL + public number → source-grounded import → reviewable
  merchant Agent/KB draft (found/inferred/missing/merchant-confirmed) → approve → internal number
  provisioning → auto webhook + mapping → precise carrier forwarding guidance → live-test detection →
  "live" confirmation. **Level 2 is NOT self-serve — it is operator-assisted.** Full stages:
  `docs/activation-flow.md`.

- **Full Level — fully self-serve public SaaS.** A merchant registers, pays, configures, activates,
  tests, manages, and cancels **without** Eric. The ranked "Blockers" backlog below (billing
  enforcement, legal review, in-app deletion, durable cross-instance rate limiting, customer number
  provisioning, scale, integration/e2e tests, …) is the **Full-Level scope. Those findings remain
  valid but are NOT the current execution scope** — do not implement them during Level 1/2 work unless
  a concrete Level 1/2 failure needs a narrowly related fix.

## Current state — [verified]
- `npm run build` ✓, `npm run qa:units` **149 ✓**, `npm run qa:call-pipeline` **46 ✓**.
- The code is at a **supervised concierge-pilot** bar: a browser or phone call answers, captures the
  request, saves it, and the daily digest can be sent. Security fundamentals are careful (server-only
  OpenAI key + 300s ephemeral browser secret; Twilio signature verify; timing-safe cron/bridge secrets;
  shared transcript/turn-taking/post-call core so browser and phone can't drift).
- It is **not** a self-serve public SaaS yet. The gaps below are launch-readiness, not broken code.

---

## Blockers to a full self-serve public launch (ranked)

> **Scope note:** this ranked list is the **Full-Level** backlog (see Readiness levels above). It stays
> valid, but is **not** the current execution scope — the active target is **Level 1** (one real
> forwarded call). Don't start these during Level 1/2 work unless a concrete failure requires it.

### 🔴 Hard blockers — can't safely onboard a paying stranger

1. ✅ **Phone onboarding is concierge — by design, not a blocker.** [verified]
   The intended pilot model: the merchant **keeps their existing public number** and forwards after-hours
   calls to a hidden per-business Twilio number Eric assigns (`businesses.twilio_number` via
   `npm run pilot:map`; webhook → `/api/twilio/voice`; routed by the dialed `To`). Manual assignment is the
   **plan** for pilots, not a deficiency. **Self-serve number purchasing / auto-provisioning is future** (and
   gated on billing) — see `docs/call-forwarding-setup.md`. The real open item is not "self-serve"; it's
   completing a **real forwarded-call acceptance test** (below).

2. ✅ **Tenant isolation (RLS) — RESOLVED & VERIFIED (2026-07-10).**
   Live-DB audit confirmed all 11 business-data tables have RLS enabled with correct `business_id`/`user_id`-scoped
   policies covering **both reads and writes** (via `is_business_member()` / `is_business_owner_or_manager()`), plus
   app-layer defense-in-depth (`getActiveBusiness()` scopes by `user_id`). **No cross-tenant leak.** Migration drift
   was also reconciled: all 7 repo migrations now match production — `supabase db push` applied 4 that were silently
   missing (restored durable `pilot_requests` lead storage, `businesses.twilio_number` routing/`pilot:map`,
   `calls.analysis`, and the reservation auto-confirm functions). **Remaining (optional, DR only):** the *core*
   tables + RLS + helper functions still aren't captured as a baseline migration — run `supabase db pull` when
   convenient so a fresh/branch environment is reproducible.

3. **Billing is disconnected — there's no automated way to get paid.** [verified]
   `stripe.ts` + `/api/billing/*` are wired, but nothing enforces subscription status anywhere, and both
   pricing CTAs are "Start a pilot" → `/contact`, bypassing checkout (`pricing/page.tsx`). Product is
   free-by-default. To publish: wire checkout into the funnel + gate on `billing_subscriptions.status`, or
   deliberately stay concierge.

### 🟠 Functional blockers — the core deliverable can silently fail

4. ✅ **Digest cron cadence — FIXED (2026-07-12).** [verified]
   The old `hour ≥ digest_send_hour` gate meant Pacific/Mountain/Alaska/Hawaii businesses (incl. the
   `America/Vancouver` default) were skipped every day and never got a report under Vercel Hobby's single
   13:00 UTC tick. Now the daily tick delivers every business's digest, deduped once per local day;
   `digest_send_hour` is best-effort (honored exactly only under an hourly Pro cron). Regression-tested.
   **Remaining (external):** confirm on the deployed cron with a Pacific business.

5. **The phone path (what real callers hit) is thinner than the browser path.** [verified code; NOT VERIFIED on a live call]
   The bridge uses OpenAI's server auto-response with none of the browser's Layer-2 turn-taking
   (`twilio-bridge.ts`). Safety caps make it safe to *test* (10-min max, 30s idle, end-cue drain, one bounded
   reconnect), but mid-sentence cutoffs are possible and a mid-call reconnect resets conversation context.

### 🟡 Infra & scale ceilings — fine for a pilot, real for "fully published"

6. **Two runtimes, manual per-deploy wiring.** [verified] The bridge can't run on Vercel (needs a durable
   WebSocket) → separate always-on host. `OPENAI_API_KEY` must be on **both** app and bridge or reports
   silently degrade to "analysis pending".
7. **Single bridge process, no failover** — a crash drops every live call (`startBridge()`). [verified]
8. **In-memory rate limiter is per-instance** (`rate-limit.ts`) — the ~12/min cap on minting **paid** OpenAI
   sessions is bypassable via serverless fan-out (cost-abuse surface). [verified]
9. **Whole KB injected into every prompt** (no retrieval); digest cron is sequential N+1; every inbound call
   scans all businesses. [verified]
10. **No end-to-end tests on the highest-risk code** — the 187 passing tests cover pure helpers only;
    `voice/page.tsx`, the bridge, save/extraction routes, and the digest cron have no integration coverage. [verified]
11. **Legal skim of `/privacy` + `/terms`** — call transcripts are personal info (PIPEDA / BC PIPA) processed on
    US servers; the pages exist but haven't had the legal review the deployment checklist flags. [EXTERNAL]

---

## Task list

### P0 — before the first real customer
- [x] **Supabase RLS verified secure** (2026-07-10) — all 11 tables RLS-enabled + correctly scoped (reads + writes); no cross-tenant leak.
- [x] **Migration drift reconciled** (2026-07-10) — 3 already-applied migrations repaired as `applied`; 4 silently-missing ones applied via `supabase db push` (fixed: durable lead storage, twilio routing, calls.analysis, reservation fns).
- [ ] (Optional, DR) Capture the **core-schema baseline** via `supabase db pull` so a fresh/branch env is reproducible.
- [ ] [EXTERNAL] **One real FORWARDED-call acceptance test** end-to-end (`docs/call-forwarding-setup.md`) — a forwarded after-hours call answers as the right business, and caller-ID survives the forward. The phone path is code-complete but unproven live.
- [ ] [EXTERNAL] **Deploy**: Vercel app + durable bridge host + full env matrix + Twilio number → `businesses.twilio_number` (`docs/deployment-checklist.md`, `docs/twilio-setup.md`).
- [ ] [EXTERNAL] **`OPENAI_API_KEY` on BOTH app and bridge**, plus `OPS_ALERT_SMS_TO` and an OpenAI budget alert.
- [x] **Digest cron cadence fixed** (2026-07-12) — delivers on the daily tick regardless of send hour; regression-tested. (External: confirm on the deployed cron.)
- [ ] (Recommended) **Commit a baseline schema migration** so schema + RLS are reproducible (`docs/supabase-rls-verification.md` Step 3).

### P1 — for a self-serve public launch
- [ ] (Future, post-pilot) **Five-minute activation flow** (`docs/activation-flow.md`) — website import → reviewable draft agent, operator-run number provisioning (purchase + webhook auto-config + auto-map, **gated on approval + billing**), guided forwarding UI, and an in-UI live acceptance-test detector. Replaces the concierge assign step; **not** a pilot requirement. Phase B is operator-driven; full customer self-serve is Phase C.
- [ ] **Wire + enforce billing** (checkout in the funnel, gate features on `billing_subscriptions.status`) or a deliberate decision to stay concierge.
- [ ] **Move rate-limiting to a shared store** (Upstash/Redis) — the in-memory limiter is per-instance.
- [ ] **In-app data-deletion flow** (replaces the manual SOP in `docs/first-customer-onboarding.md`).
- [ ] Legal skim of `/privacy` + `/terms`; mobile-device QA pass.
- [ ] Wire the live conversational eval (`npm run qa:agent-evals`) into CI once a CI key exists.

### P2 — scale / polish
- [ ] Bridge **horizontal scale / failover** (single Node process today).
- [ ] **KB retrieval** for large knowledge bases (currently whole-KB prompt injection).
- [ ] Integration/e2e coverage for `voice/page.tsx`, the bridge, and the digest cron.
- [ ] Consolidate the duplicate WebRTC clients + demo fixtures (`docs/demo-architecture-debt.md`).
- [ ] Native OpenAI Agents SDK `RealtimeAgent` handoffs + live mid-call tool-calling (`docs/agent-specialists.md`).

---

_Deep references: `docs/deployment-checklist.md` + `docs/twilio-setup.md` (deploy the phone path),
`docs/call-forwarding-setup.md` (forwarding + the real acceptance test), `docs/supabase-rls-verification.md` (the RLS gate)._
