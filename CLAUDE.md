# FrontDesk — Claude Code Project Guide

FrontDesk is a real SaaS MVP: an **after-hours / missed-call capture** service for local service
businesses. It answers the calls a business was already missing (after hours, no-answer, busy),
captures the caller's request naturally using business knowledge, saves the call, and sends the
owner **one clean daily report**. It is a lightweight answering service — **not** a full daytime
staff replacement.

Claude Code is the implementation agent. Eric / ChatGPT are PM, QA, and final approval.

**This file is the root constitution and index — keep it lean.** It holds permanent rules, safety,
workflow, and pointers. Deep detail lives in `docs/` (linked below). Do not use this file as a
changelog. When architecture changes, update the relevant doc **in the same task**.

## Current MVP direction

FrontDesk is an **after-hours / missed-call capture** system. The business forwards no-answer /
busy / after-hours calls to FrontDesk; it answers, captures the caller's request, and saves the
call. The owner's main deliverable is **one daily report**:

- **Email summary + CSV is the primary report.** **SMS is an optional short alert only** — never
  required.
- The **dashboard is secondary** (settings / call history / report archive), not a daily operations
  cockpit. The owner does not need to live in it.
- Appointments / service requests are **captured caller outcomes**, not a forced workflow or the
  core adoption requirement.
- Do **not** position FrontDesk as a full daytime staff/receptionist replacement.
- **No-domain mode is valid:** `RESEND_API_KEY` may be set while `NOTIFY_EMAIL_FROM` is intentionally
  missing until a sender domain is configured. Email then **skips safely**, SMS still works, the cron
  records status and never crashes. **Never imply production email is fully enabled while the sender
  domain is missing** — the Settings notice + `/api/notify-status` probe enforce this.

Deeper detail: `docs/product-scope.md` and `docs/after-hours-report.md`.

## Documentation index

- Product scope & positioning → `docs/product-scope.md`
- Voice / call pipeline (and voice-bug diagnosis) → `docs/call-pipeline.md`
- Agent conversation behavior → `docs/agent-behavior.md`
- Engineering standards (anti-spaghetti, detailed) → `docs/engineering-standards.md`
- Design system & UI conventions → `docs/design-system.md`
- Demo/real architecture & known debt → `docs/demo-architecture-debt.md`
- Deployment (env matrix, Vercel/Supabase/Twilio, rollback) → `docs/deployment-checklist.md`
- Phone go-live (Twilio + bridge, step-by-step) → `docs/pilot-go-live.md`
- First-customer onboarding (concierge pilot path) → `docs/first-customer-onboarding.md`
- Supabase RLS verification (tenant-isolation gate) → `docs/supabase-rls-verification.md`
- Codebase audit (known issues, severity-ranked) → `docs/full-codebase-audit.md`

## Tech stack

- Next.js App Router (`src/`), TypeScript strict, Tailwind CSS
- Supabase Auth + Postgres + RLS
- OpenAI Realtime API via browser WebRTC; server mints ephemeral sessions, browser never gets the raw key
- Vercel deployment (incl. Cron → `/api/cron/digest` for the daily report)
- Reporting integrations (server-side only): **Resend** (email report + CSV) and **Twilio** (optional
  SMS report alert). Twilio is also the approved inbound-phone path, but **real call forwarding
  requires a deployed/verified Twilio bridge** and is not production-verified by default
  (`docs/twilio-setup.md`). Stripe billing scaffolding exists in the repo but is **not enforced and
  not part of the reporting MVP focus** (`docs/stripe-setup.md`).

Use the existing configured model and Realtime architecture. **Do not change model, provider, or
voice platform unless Eric explicitly approves.**

---

## Permanent Safety Rules (non-negotiable)

### Secrets
1. Never read, print, cat, grep, edit, or stage `.env.local` or any `.env.*` file.
2. Never print or log `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, tokens, or secret values.
3. The OpenAI API key must stay server-side only.
4. The browser may receive only an ephemeral client secret from `/api/voice-session`.
5. Never use Supabase service-role keys in frontend or client-accessible code.

### Database / RLS
6. Never bypass Row Level Security.
7. Use `business_id`-scoped queries for real data; never return cross-business data.
8. Never run destructive DB commands without explicit Eric approval (`supabase db reset`,
   `DROP TABLE`, `TRUNCATE`, destructive `psql`, destructive migrations).

### Git
9. Never commit unless Eric explicitly asks.
10. Never run destructive git commands without explicit approval (`git reset --hard`,
    `git clean -fd`, `git push --force`).
11. Run `git status --short` before and after meaningful changes.
12. Before any approved commit, run `npm run build`.
13. Never stage `.env.local`, `.env.*`, hook logs, temp debug files, or generated artifacts.

### Product
14. Keep demo mode working.
15. Keep the platform generalized across service businesses (restaurants are only the first demo
    vertical — see `docs/product-scope.md`).
16. Do not add or expand billing, payments, new phone-provider integrations, production
    phone-number flows, or new messaging/reporting channels unless Eric explicitly approves.
    Existing approved Twilio/Resend reporting code may be maintained and improved within the
    missed-call reporting MVP.
17. Never claim the assistant is a human. Never say an appointment is "confirmed" unless the flow
    truly confirms it.

Supported `business_type`: `restaurant | auto_repair | salon | clinic | tutoring | home_services | other`.

---

## Core engineering principles

Short version (full detail: `docs/engineering-standards.md`):

1. **Inspect before editing.** Ask questions until ~95% confident. Don't guess paths, data flow,
   helpers, types, source of truth, or side effects.
2. **Find the source of truth** before adding code; don't create a second source of truth unless
   approved. Current sources of truth:
   - Transcript → `buildTranscript()` over Realtime turns (`src/lib/call-pipeline/transcript.ts`)
   - Current business time → `nowInTimeZone()` (`src/lib/call-pipeline/time.ts`)
   - Active business → `getActiveBusiness()` (`src/lib/supabase/businesses.ts`)
   - Demo business → `getDemoBusiness()` (`src/lib/agents/demoBusinesses.ts`)
   - Appointment status → `effectiveStatus()` (`src/lib/appointments.ts`)
   - Prompt assembly → `buildSystemPrompt()` (`src/lib/agents/core/promptBuilder.ts`)
   - Response creation (Layer 2, app-controlled) → `sendResponseCreate()` (`src/app/dashboard/voice/page.tsx`)
3. **Replace, don't stack.** Fix the wrong path; if it stays as fallback, gate it clearly; if
   obsolete, remove it. No parallel/conflicting paths.
4. **No broad refactors during feature fixes.** Keep changes small and reversible.
5. **Tests target the new source of truth.** Add deterministic unit tests for new helpers.
6. **Update docs when architecture changes** — never leave docs contradicting code.

### Best MVP fix principle
Prefer the strongest practical fix for a sellable MVP — not the tiniest patch that leaves the bug
alive, not future enterprise architecture. In reports, recommend the best MVP path directly with
tradeoffs; avoid long A/B/C menus unless Eric asks.

### Voice-bug diagnosis principle
**Voice bugs are not prompt-only by default.** Diagnose by pipeline **layer** before changing the
prompt (mic capture → noise/VAD → endpointing → barge-in → response creation → audio playback →
transcript capture → save → extraction). A full assistant sentence in the transcript with audio
that was cut off is a **playback/interruption** issue, not a prompt issue. Full layered checklist:
`docs/call-pipeline.md`.

---

## Workflow

For each task:
1. Restate the problem briefly.
2. Inspect relevant files; identify the source of truth.
3. Recommend the best MVP fix (diagnose first for bugs; don't implement until approved when asked).
4. Implement only approved scope.
5. Run required QA.
6. Report exactly what changed. Do not commit unless Eric asks.

### Required final report
1. Files changed
2. Root cause
3. What changed
4. What was intentionally not changed
5. Tests / QA run
6. Build result
7. `git status --short`
8. Any manual test needed

### QA before any approved commit
- [ ] `npm run build` passes
- [ ] relevant QA scripts pass (`npm run qa:call-pipeline`, `npm run qa:units`)
- [ ] `git status --short` reviewed; only intentional files; `.env.*`, hook logs, secrets not staged
- [ ] demo mode still works
- [ ] no restaurant-only shared code
- [ ] no obsolete path still overwriting the new source of truth
- [ ] docs updated if architecture changed

---

## Directory guide

```txt
src/app/                    App Router pages and routes
src/app/api/voice-session/  Realtime session creation
src/app/dashboard/voice/    Live browser voice test
src/components/             Shared UI components
src/lib/agents/core/        Prompt assembly / global behavior
src/lib/agents/verticals/   Vertical-specific business judgment
src/lib/call-pipeline/      Transcript, extraction, time, noise helpers
src/lib/supabase/           Supabase clients and business data
tests/voice-agent-evals/    Static eval cases
scripts/                    QA scripts
docs/                       Architecture and workflow docs
```
