# FrontDesk — Full Codebase Audit

**Date:** 2026-07-05
**Scope:** Repository-wide audit across 15 perspectives (architecture, state, agent workflow, tool-calling, Twilio, OpenAI Realtime, DB consistency, security, performance, dead code, duplication, tech debt, testing, UI, scalability).
**Rule:** Diagnostic only — no code was changed for this audit.

---

## ⚠️ Methodology & a required caveat (read first)

This audit was designed as a **parallel multi-agent** review (five perspective agents) followed by an **independent cross-verification wave** ("no finding trusted until a second agent verifies it").

The five perspective agents ran, but **hit a hard session/usage limit (resets ~6:20pm PT) and returned truncated output**, and the verification wave could not run for the same reason. Rather than block, the findings below were authored from **direct, first-hand inspection performed across this working session** — during which the critical files were personally read, and several subsystems were additionally modified and covered by passing deterministic tests (the strongest verification available here).

**Each finding therefore carries an explicit verification basis:**
- **`impl+tests`** — corroborated by changes made and tests run this session (highest confidence).
- **`read-verified`** — confirmed by reading the cited code directly.
- **`inferred`** — strongly indicated but not independently re-confirmed; treat as a lead.

**Recommended next step:** re-run the independent verifier wave after the limit resets to satisfy the "two-agent" bar, focusing on the `inferred` items and the RLS question (F1), which cannot be fully resolved from the repo alone.

> **Working-tree note:** this audit reflects the code **as it currently exists on disk**, which includes several **uncommitted** improvements made earlier this session (multi-tenant Twilio routing, digest-failure retry, durable lead storage, per-call quality metrics, reconnect handling). Issues those changes already address are listed under **"Recently addressed"** so they are not double-counted as open risks.

---

## Severity summary

| Sev | Count | Headline items |
|-----|-------|----------------|
| **Critical** | 1 | Base DB schema + **RLS policies not in version control → cross-tenant isolation is unverifiable** |
| **High** | 5 | Single-process phone bridge (scale ceiling); phone path lacks Layer-2 (reliability); in-memory rate-limit ineffective across serverless instances; no tests on the highest-risk code; unversioned schema blocks DR/reproducibility |
| **Medium** | 8 | Vercel cron cadence vs send-hour; whole-KB prompt injection; digest N+1; per-inbound-call DB scan; 1900-line voice component; duplicate WebRTC clients / demo fixtures; capture-only ceiling (no tool-calling); extraction-skip footgun |
| **Low** | 5 | Dead Stripe/billing scaffolding; restaurant-legacy Orders/Reservations; duplicated per-page fetch boilerplate; batch-transcription model retirement; doc↔code drift risk |

---

## CRITICAL

### C1 — Base schema and RLS policies are not in version control; cross-tenant isolation is unverifiable
- **Perspective:** database consistency / security
- **Location:** `supabase/migrations/` (only migrations present: `20260606_reservation_auto_confirm.sql`, `20260611000000_billing_subscriptions.sql`, `20260611000001_calls_source.sql`, `20260616000000_call_digests.sql`, plus the two uncommitted `20260702*`). **None create `businesses`, `calls`, `call_messages`, `appointments`, `service_requests`, `customers`, `profiles`, `business_members`** or their RLS policies.
- **Evidence:** `src/lib/supabase/admin.ts` documents that the service-role client "is not an RLS bypass for user requests … the tables it writes keep their RLS for all user-facing reads" — i.e. **tenant isolation depends entirely on RLS policies that do not exist anywhere in the repo.** User-facing reads (e.g. `getActiveBusiness` in `src/lib/supabase/businesses.ts`, dashboard `calls`/`reservations` pages) rely on RLS to scope by `business_id`; that policy set cannot be reviewed.
- **Impact:** (1) **Security:** if any base-table RLS policy is missing or wrong in the live DB, one business could read another's calls/customers (PII). This cannot be ruled out from the codebase. (2) **DR/reproducibility:** the database cannot be recreated from the repo — a lost Supabase project or a new staging env means reverse-engineering the schema. (3) **Drift:** no migration history for the core tables.
- **Verification basis:** `read-verified` (migration inventory + admin.ts contract). **The actual RLS correctness is UNVERIFIABLE from the repo — this is the single most important item for a second reviewer (with DB access) to confirm.**
- **Direction (not a fix):** dump the live schema + RLS into a baseline migration and commit it; then audit each base table for a `business_id`-scoped `SELECT` policy.

---

## HIGH

### H1 — The phone bridge is a single Node process with no horizontal scaling or failover
- **Perspective:** scalability
- **Location:** `server/twilio-bridge.ts` (`startBridge()` — one `http.createServer` + one `WebSocketServer`; per-call state held in closures inside `handleTwilioConnection`).
- **Evidence:** all inbound Twilio Media Streams terminate on one process; `bridgeMetrics.activeStreams` is an in-process counter; there is no load balancer, shared queue, or multi-instance coordination. Vercel cannot host it (serverless has no durable WS — the reason it's standalone).
- **Impact:** the advertised "answer the calls you're missing" cannot survive a burst. A few dozen concurrent calls strain one box; a crash drops **every** live call. The "10,000 calls tomorrow" scenario is impossible without a rearchitecture (multiple bridge instances behind a Twilio-aware balancer).
- **Verification basis:** `read-verified`.

### H2 — The phone path runs OpenAI's server auto-response with none of the browser's Layer-2 orchestration
- **Perspective:** agent workflow / realtime pipeline (reliability)
- **Location:** `server/twilio-bridge.ts` (session uses `create_response` at the server default = auto-response; no app-owned `sendResponseCreate`, no hold-then-answer, no playback-aware end) vs `src/app/dashboard/voice/page.tsx` (full Layer-2).
- **Evidence:** `docs/call-pipeline.md` §8 explicitly states the phone path is "a controlled-test safety patch, **not** full pilot/production hardening," and that competing background speech can trigger a server-side `output_audio_buffer.cleared` that cuts the assistant off mid-sentence.
- **Impact:** the surface **real customers use** is measurably lower-quality than the browser test surface — mid-sentence cut-offs, worse overlap handling, no controlled turn-taking. Directly undermines "reliably solve the caller's concern."
- **Verification basis:** `read-verified` (docs + bridge code, corroborated by this session's reliability work).

### H3 — Rate limiting and ops-alert cooldowns are in-memory per-instance → ineffective on Vercel and reset on cold start
- **Perspective:** security / scalability
- **Location:** `src/lib/rate-limit.ts` (module-level `Map`), consumed by `src/app/api/voice-session/route.ts` (~12/min/client cap on **paid** Realtime session minting) and `src/app/api/pilot-request/route.ts`; `src/lib/notify/ops.ts` (in-memory alert cooldown `Map`).
- **Evidence:** the limiter state lives in a per-process `Map`. Vercel runs many serverless instances and recycles them; a client's requests spread across instances each see a fresh counter.
- **Impact:** (1) **Cost-abuse:** the intended cap on minting paid OpenAI Realtime sessions is largely bypassable by fan-out across instances → unbounded paid sessions. (2) **Alert storms:** the ops-alert cooldown doesn't hold across instances, so a systemic failure can page repeatedly. Both silently degrade at exactly the moment they matter.
- **Verification basis:** `read-verified` (limiter is a local Map; I consumed it while adding the pilot-request path). Severity is High because it guards spend.

### H4 — The highest-risk code has no automated test coverage
- **Perspective:** testing
- **Location:** tests are `scripts/qa-units.ts` + `scripts/qa-call-pipeline.ts` (pure helpers only, ~165 cases) and `scripts/qa-agent-evals.ts` (needs a live key, not in CI). No React component tests, no e2e, no API-route integration tests.
- **Evidence:** the live voice pipeline (`voice/page.tsx`, `server/twilio-bridge.ts`), the save/extraction routes (`api/twilio/post-call`, `api/post-call`, `postCallCore.ts`), and the digest cron are exercised only by pure-helper unit tests around them — never end-to-end. `tests/voice-agent-evals/*` only validates dataset **integrity**, not model behavior.
- **Impact:** the components most likely to break in front of a customer (real calls, saving, the daily report) have no regression net. A refactor to `voice/page.tsx` or the bridge can silently break calls with all "tests" green.
- **Verification basis:** `impl+tests` (I authored tests here and know exactly what is and isn't covered).

### H5 — No reproducible database / environment (companion to C1)
- **Perspective:** database consistency / tech debt
- **Location:** `supabase/migrations/` (see C1).
- **Evidence:** core tables and their columns (e.g. `calls.next_action`, `calls.source`, `businesses.agent_config`, `businesses.twilio_number`) are added piecemeal via `add column if not exists` migrations, but the tables themselves were created out-of-band. Several code paths defensively retry inserts to tolerate missing columns (`api/twilio/post-call/route.ts` retries the `calls` insert without `source`).
- **Impact:** onboarding a new environment, running staging, or recovering from a Supabase incident all require manual schema reconstruction; column drift between environments is likely and unobservable.
- **Verification basis:** `read-verified`.

---

## MEDIUM

### M1 — Vercel Hobby cron runs once/day but the digest logic assumes hourly → per-business send-hour is largely non-functional
- **Perspective:** performance / reliability
- **Location:** `vercel.json` (`"schedule": "0 13 * * *"` — one daily tick at 13:00 UTC) vs `src/app/api/cron/digest/route.ts` (comment: "Vercel Cron calls this HOURLY"; sends only once the business-local hour ≥ `digest_send_hour`, default 8).
- **Evidence:** with a single 13:00 UTC tick, a US-Pacific business (≈05:00–06:00 local) is *before* an 08:00 send hour → skipped, and the next tick is 24h later. `docs/pilot-go-live.md` acknowledges the workaround ("set each pilot's send hour at/before that tick").
- **Impact:** some businesses may **never** receive the daily report (the entire product deliverable) unless their send hour is coincidentally ≤ the single tick's local time. Brittle and silent.
- **Verification basis:** `read-verified`.

### M2 — Whole knowledge base is injected into every prompt (no retrieval)
- **Perspective:** performance
- **Location:** `src/lib/agents/core/promptBuilder.ts` — `knowledge.map((k) => \`- [${k.category}] ${k.question}: ${k.answer}\`).join('\n')` concatenates the entire KB into the system prompt.
- **Impact:** fine at demo scale (a 14k-char prompt observed), but a business with a large KB bloats every session prompt → higher latency, higher token cost, and dilution of instruction-following. No retrieval/truncation ceiling.
- **Verification basis:** `read-verified`.

### M3 — Digest cron processes businesses sequentially with per-business queries (N+1)
- **Perspective:** performance / scalability
- **Location:** `src/app/api/cron/digest/route.ts` — `for (const biz of businesses) { … await processBusiness(…) }`, and within each: a `call_digests` idempotency read, a high-water-mark read, a `calls` window query, and an `appointments` `.in('call_id', callIds)` query.
- **Impact:** run time grows linearly with business count and each business incurs multiple round-trips. With hundreds of businesses on a single serverless invocation this risks the function timeout and delays/omits reports. (Correctness is fine; throughput is not.)
- **Verification basis:** `read-verified`.

### M4 — Every inbound phone call scans all businesses with a mapped number
- **Perspective:** performance / scalability
- **Location:** `src/app/api/twilio/voice/route.ts` — `resolveBusinessId()` runs `.from('businesses').select('id, twilio_number').not('twilio_number','is', null)` and matches in JS on **every** inbound call.
- **Impact:** negligible at pilot scale, but it's an O(businesses) fetch on the latency-sensitive call-answer path. Should become an indexed equality lookup on a normalized column before scale. (Introduced by this session's multi-tenant routing fix — flagged for follow-up.)
- **Verification basis:** `impl+tests` (I wrote it).

### M5 — `voice/page.tsx` is a ~1,900-line client component with heavy `useRef` state
- **Perspective:** state management / tech debt
- **Location:** `src/app/dashboard/voice/page.tsx` (~1,923 lines; dozens of refs coordinating response-in-progress, playback, pending turns, timers, reconnect).
- **Impact:** high cognitive load and real race-condition surface (ref-based state read/written across async Realtime events + timers). Correctness today rests on careful ordering that is easy to break in edits and has no component-level test. Maintainability risk more than a proven bug.
- **Verification basis:** `read-verified` (line count + ref density observed; I edited it this session).

### M6 — Duplicate WebRTC clients and duplicate demo fixtures (drift risk)
- **Perspective:** duplication / tech debt
- **Location:** `src/app/dashboard/voice/page.tsx` and `src/components/CallSimulatorDemo.tsx` each implement the Realtime/WebRTC handshake and diverge on noise/transcript handling; `src/lib/agents/demoBusinesses.ts` and `src/lib/mock-data.ts` (`MOCK_RESTAURANT`) both model "Bella Notte" separately.
- **Evidence:** documented as known debt in `docs/demo-architecture-debt.md` (items 3 & 4) and confirmed present.
- **Impact:** two sources of truth for the call client and for demo data → behavior/data can drift between the landing demo and the dashboard. Bug fixes must be made twice.
- **Verification basis:** `read-verified` (doc claims confirmed against files).

### M7 — Capture-only ceiling: no tool/function-calling; in-call correctness is prompt-only
- **Perspective:** agent workflow / tool calling
- **Location:** `src/lib/agents/core/globalRules.ts` + `docs/call-pipeline.md` (§"Deferred": "real-time tool/function-calling enforcement is intentionally not used"). Deterministic guards like `isPastAppointment` (`src/lib/call-pipeline/pastTime.ts`) run **post-call**, not in-call.
- **Impact:** the agent cannot check real availability, look up an order, or reliably reject a past/closed time **during** the call — it can only capture and let staff confirm. This is a deliberate design, but it caps "solving the caller's concern," and in-call date/time correctness relies on the model following prompt rules (acknowledged as unreliable in the docs).
- **Verification basis:** `read-verified`.

### M8 — Extraction silently degrades to "analysis pending" when the app is missing `OPENAI_API_KEY`
- **Perspective:** reliability / ops
- **Location:** `src/app/api/twilio/post-call/route.ts` — when `process.env.OPENAI_API_KEY` is absent, the call is saved but extraction is skipped (`extractionSkippedResponse`), so the report shows no caller name/summary/intent.
- **Evidence:** the bridge and the Vercel app are **separate deployments**; the key can be set on one and forgotten on the other. The route logs loudly and fires an ops alert (good), but the failure mode still produces a useless morning report.
- **Impact:** a whole day of reports can be content-free from a single missing env var on the app. Mitigated by the loud alert, not prevented.
- **Verification basis:** `impl+tests` (this path is unit-tested via `extractionSkip`).

---

## LOW

### L1 — Dead Stripe/billing scaffolding
- **Perspective:** dead code
- **Location:** `src/lib/billing/*`, `src/app/api/billing/{checkout,portal,status,webhook}/route.ts`, `src/components/{BillingCard,CheckoutButton}.tsx`, migration `20260611000000_billing_subscriptions.sql`.
- **Evidence:** `CLAUDE.md` and `docs/product-scope.md` state billing is "present, not enforced, not part of the reporting MVP." No feature gating consumes it.
- **Impact:** maintenance surface and reviewer confusion for a capability that isn't used. Low risk; candidate for removal or clear quarantine.
- **Verification basis:** `read-verified`.

### L2 — Restaurant-legacy surfaces contradict the "generalized product" thesis
- **Perspective:** UI consistency / product
- **Location:** `src/app/dashboard/orders/page.tsx`, `src/app/dashboard/reservations/*` (MonthHeatmap, WeekGrid, AddAppointmentModal), `src/lib/mock-data.ts` (`MOCK_RESTAURANT`).
- **Evidence:** `docs/product-scope.md` says the dashboard is secondary and appointments are "captured outcomes, not a forced workflow," yet a full booking cockpit + an "Orders" concept exist and read as restaurant-specific to a plumber/clinic.
- **Impact:** dilutes the generalized positioning and adds UI to maintain that the product thesis says isn't the point. Low severity (cosmetic/product).
- **Verification basis:** `read-verified`.

### L3 — Duplicated per-page loading/demo/real fetch boilerplate
- **Perspective:** duplication
- **Location:** dashboard pages (`calls`, `reservations`, `orders`, `knowledge`) each keep their own `loading/demo/real` machine + `getActiveBusiness` + query.
- **Evidence:** called out in `docs/demo-architecture-debt.md` item 1 ("a `useDashboardData()` hook … not required for correctness").
- **Impact:** repeated code; changes to the fetch/demo contract must be made per page. Low.
- **Verification basis:** `read-verified`.

### L4 — Batch-transcription model retirement risk
- **Perspective:** tech debt
- **Location:** `docs/call-pipeline.md` §4 warns "Batch transcribe models retire ~June 2026"; `BATCH_TRANSCRIPTION_MODEL` in `src/lib/call-pipeline/constants.ts`, used by `src/app/api/transcribe-call/route.ts`.
- **Impact:** the fallback transcription path (used when Realtime captured no caller turns) may break on/after the retirement date. Verify the model is still accepted.
- **Verification basis:** `inferred` (doc-stated date; not re-checked against the provider).

### L5 — Doc↔code drift risk from uncommitted changes
- **Perspective:** tech debt
- **Location:** `docs/pilot-go-live.md` ("One env-configured number → one business"; "no retry on a failed send") now contradicts the uncommitted multi-tenant routing + digest-retry changes.
- **Impact:** docs mislead until updated. Low.
- **Verification basis:** `impl+tests`.

---

## Recently addressed (uncommitted working-tree changes — do not double-count)

These were fixed earlier this session and are present on disk (pending commit); listed so they aren't re-counted as open:
- **Digest failure = permanent report loss** → gated by `shouldAdvanceCoverage` in `src/lib/notify/digest.ts`; the cron no longer advances the high-water mark on a failed send (`api/cron/digest/route.ts`).
- **Single-tenant phone routing** → `businesses.twilio_number` + `matchBusinessIdByNumber` resolve the business from the dialed number (`api/twilio/voice/route.ts`, `src/lib/twilio/numberRouting.ts`).
- **Lead loss on unconfigured email** → durable `pilot_requests` insert via service role (`api/pilot-request/route.ts`, `src/lib/leads/pilotLead.ts`).
- **No call-quality observability** → per-call metric + ops alert (`src/lib/call-pipeline/callQuality.ts`, wired into bridge + `api/twilio/post-call`).
- **Instant teardown on transient WebRTC drop / 30s dead air on OpenAI drop** → browser grace window (`src/lib/realtime/connectionState.ts`) + bounded bridge reconnect (`decideOpenAIDropAction`). **Residual risk:** the phone reconnect resets conversation context and is not yet validated on a real call.

---

## Verified healthy (do not "fix")

- **Prompt engineering is a genuine strength** — `src/lib/agents/core/globalRules.ts` enforces anti-hallucination ("DON'T INVENT"), no-false-confirm, exact-digit phone handling, one-question-at-a-time, and sane language switching.
- **Security fundamentals are careful** — the OpenAI key stays server-side; the browser only ever receives an ephemeral client secret (`api/voice-session/route.ts`, `expires_after` 300s); service-role client is server-only (`supabase/admin.ts`); Twilio webhook signatures are verified (`lib/twilio/signature.ts`) with URL canonicalization; `CRON_SECRET` and `TWILIO_BRIDGE_SECRET` use `timingSafeEqual`; the `debug/*` route and the dev event timeline are gated to non-production; TwiML output is XML-escaped (`api/twilio/voice/route.ts`).
- **Single-source-of-truth discipline** — shared VAD/turn-taking (`lib/realtime/turnDetection.ts`), transcript assembly (`buildTranscript`), and post-call core (`postCallCore.ts`) are shared by browser + phone so they can't drift.
- **Idempotent call teardown** — the bridge funnels all end reasons through one `finish()` guarded by `closed`, clearing every timer exactly once.
- **~165 passing deterministic tests** for the pure pipeline helpers (`npm run qa:units`, `npm run qa:call-pipeline`).

---

## What still needs an independent second pass (verification wave could not run)

Re-run the independent verifier agents (after the session limit resets) prioritizing:
1. **C1 / RLS correctness** — requires DB access; cannot be resolved from the repo.
2. **H3 rate-limit bypass** — confirm Vercel instance fan-out actually defeats the per-process limiter in practice.
3. **M5 race conditions in `voice/page.tsx`** — a focused concurrency review of the ref/timer interactions.
4. **L4 batch-transcription model** — confirm current provider availability.
