# STATUS — first-customer readiness (live)

_Newest first. Full audit: `reports/production-readiness-report.md`. Tasks: `PRODUCTION_TASKS.md`._

## Specialist voice-agent architecture (this run)
Upgraded the single-agent voice behavior to a **modular router + specialists + post-call analyst**,
without changing the transport or breaking the tuned voice path (`docs/agent-specialists.md`).
- **Done + verified:** `src/lib/agents/routing/intents.ts` (intent→specialist, pure, tested);
  `src/lib/agents/specialists/{router,booking,faq,escalation}.ts` + `index.ts` composed into an
  **additive** `SPECIALIST PLAYBOOKS` section in `buildSystemPrompt` (GLOBAL_RULES unchanged; browser +
  phone share it, no duplication); `src/lib/call-pipeline/analyst.ts` (`buildAnalystResult` → structured
  staff analysis, transcript kept separate) wired into `postCallCore` and persisted to a new
  `calls.analysis` jsonb column (migration `20260709000000_calls_analysis.sql`, defensive write).
  Tests: `qa:units` **135 ✓**, `qa:call-pipeline` **46 ✓**, `next build` ✓.
- **NOT verified (needs a key / live call):** actual live routing quality — run `npm run qa:agent-evals`
  + manual test calls (10 QA scenarios in `docs/agent-specialists.md`). No commit made.
- **Remains (deferred by design):** native OpenAI Agents SDK `RealtimeAgent` handoffs + live mid-call
  tool-calling — migration steps documented in `docs/agent-specialists.md` (P2 in `PRODUCTION_TASKS.md`).

## Verdict: ALMOST READY — one code P0 fixed this run; remaining P0s are external
The code is at a pilot bar. What's left before a live pilot is **external** (RLS confirmation, deploy,
a real phone acceptance call) — documented, not faked.

## Done this run (verified)
- **P0: hardened tenant isolation in code.** `getActiveBusiness()` filters `business_members` by the
  signed-in `user_id`, so a missing/wrong RLS policy can no longer resolve a user to another business's
  data. Guard test added.
- **Verified read-side scoping is code-enforced** — every dashboard read filters `.eq('business_id', …)`
  off the hardened active-business id (`dashboard/page.tsx:660-684`). Accidental cross-tenant reads are
  now prevented in code; RLS remains needed only for direct anon-key API access.
- **Made the RLS gate precise + safe** — verified the browser writes `calls`/`call_messages`/
  `appointments`/`business_knowledge`/`businesses` via the USER client, so a SELECT-only RLS policy would
  BREAK those flows. Documented the exact read+write (`for all` using/with-check) policy set +
  `call_messages` join in `docs/supabase-rls-verification.md` §2b. **Did NOT ship a blind migration**
  (untestable here → dangerous, per the rules).
- **Added `src/app/global-error.tsx`** — root error boundary so a pilot user never sees a raw crash.
- All green: `qa:units` **120 ✓**, `qa:call-pipeline` **46 ✓**, `next build` ✓, supervisor **exit 0**.
- Audited the whole app against the code; wrote the 8-section readiness report + these root files.
- (Consolidated the earlier `tasks/` copies into these root files to avoid drift.)

## Top blockers (all external / manual — cannot be closed in-repo)
1. **RLS not verifiable from the repo** — confirm every business-data table is `business_id`-scoped
   (`docs/supabase-rls-verification.md`). The write-side + non-active-business tables still depend on it.
2. **Real phone acceptance call** — the Twilio path is unproven on a live call.
3. **Deploy** — Vercel + bridge host + env + Twilio number mapping.

## NOT VERIFIED (do not claim as working)
- Live RLS correctness · a real inbound phone call · mobile rendering on a device · the reservation
  confirm/deletion Postgres RPCs (DB-only, unversioned) · the live-model eval (needs a key) · email
  report delivery (domain-gated).

## Rules honored
No commit/push · no secrets touched · no `.env` edits · no destructive DB actions · no voice refactor.

## Exact next task
Verify Supabase RLS (Step-1 read-only queries in `docs/supabase-rls-verification.md`). It is the single
gate that turns this from ALMOST READY → READY, and it can only be done by Eric with DB access.
