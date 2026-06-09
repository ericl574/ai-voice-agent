# FrontDesk — Claude Code Project Guide

FrontDesk is a real SaaS MVP for virtual front desk / call handling for local service businesses.

Claude Code is the implementation agent. Eric / ChatGPT act as product manager, QA reviewer, and final approval.

This file is the project constitution. Keep it lean, current, and architecture-focused. Do not use it as a changelog.

## Detailed References

Keep this file lean. Put deep details in docs:

- Design system & UI conventions → `docs/design-system.md`
- Call pipeline architecture → `docs/call-pipeline.md`
- AI collaboration workflow → `docs/ai-collaboration-workflow.md`
- Demo/real architecture & known debt → `docs/demo-architecture-debt.md`

When architecture changes, update the relevant doc in the same task if the change would make the doc misleading.

---

## Product Vision

FrontDesk is a SaaS platform for virtual front desk / answering service workflows for local service businesses.

It answers customer calls naturally, uses business knowledge, captures useful details, creates appointment/service requests when relevant, and gives staff clear next actions.

Customer-facing copy should sell a better front desk service, not an “AI bot.”

Prefer language like:

- front desk
- virtual front desk
- answering service
- call handling
- receptionist
- customer calls
- appointments
- service requests
- follow-up
- staff dashboard
- business knowledge
- Try our service

Avoid overusing:

- AI agent
- chatbot
- bot
- simulator
- automation tool

### Various Fields of Services

Restaurants are only the first demo vertical. Shared architecture, UI, schema, prompts, and copy must remain generalized.

Supported `business_type` values:

```ts
restaurant | auto_repair | salon | clinic | tutoring | home_services | other;
```

Do not hard-code restaurant-only concepts into shared code.

---

## Tech Stack

- Next.js App Router with `src/`
- TypeScript strict mode
- Tailwind CSS
- Supabase Auth + Postgres + RLS
- OpenAI Realtime API via browser WebRTC
- Server creates ephemeral Realtime sessions; browser never receives the raw OpenAI API key
- Vercel deployment

Use the existing configured model and Realtime architecture. Do not change model, provider, or voice platform unless Eric explicitly approves.

---

## Permanent Safety Rules

### Secrets

1. Never read, print, cat, grep, edit, or stage `.env.local` or any `.env.*` file.
2. Never print or log `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, tokens, or secret values.
3. The OpenAI API key must stay server-side only.
4. Browser may receive only an ephemeral client secret from `/api/voice-session`.
5. Never use Supabase service-role keys in frontend or client-accessible code.

### Database / RLS

6. Never bypass Row Level Security.
7. Use `business_id`-scoped queries for real data.
8. Never return cross-business data.
9. Never run destructive database commands without explicit Eric approval:
   - `supabase db reset`
   - `DROP TABLE`
   - `TRUNCATE`
   - destructive `psql` commands
   - destructive migrations

### Git

10. Never commit unless Eric explicitly asks.
11. Never run destructive git commands without explicit Eric approval:

- `git reset --hard`
- `git clean -fd`
- `git push --force`

12. Run `git status --short` before and after meaningful changes.
13. Before any approved commit, run `npm run build`.
14. Never stage `.env.local`, `.env.*`, hook logs, temporary debug files, or generated artifacts unless explicitly intended.

### Product

15. Keep demo mode working.
16. Keep the platform generalized across service businesses.

---

## Anti-Spaghetti Engineering Rules

These rules exist to stop the codebase from becoming a pile of patches.

### 1. Inspect before editing

Before changing files, inspect the current implementation. ALWAYS ASK questions until you are 95% confident you understand exactly!

Do not guess:

- file paths
- data flow
- existing helpers
- existing types
- existing source of truth
- existing side effects

### 2. Find the source of truth

Before adding code, identify the current source of truth.

Examples:

- Transcript source of truth
- Business timezone source of truth
- Active business source of truth
- Demo business source of truth
- Appointment status source of truth
- Prompt assembly source of truth

Do not create a second source of truth unless explicitly approved.

### 3. Replace, don’t stack

When fixing a wrong path, prefer replacing/removing the wrong path rather than adding a parallel path.

Bad:

- New logic added while old logic still writes conflicting data.
- New transcript source added while old transcription still overwrites it.
- New prompt rule added while old conflicting prompt rule remains.
- New UI state added while old state still controls behavior.

Good:

- Identify old path.
- Decide whether it remains fallback.
- If fallback, gate it clearly.
- If obsolete, remove it.
- Add tests around the new source of truth.

### 4. No broad refactors during feature fixes

Do not refactor unrelated files just because they look messy.

Allowed:

- small helper extraction if it reduces duplication for the current task
- small type cleanup needed for the current task
- removing obsolete code directly related to the fix

Not allowed:

- redesigning unrelated pages
- restructuring app directories
- changing schema without approval
- rewriting working logic for style preference

### 5. Keep changes reversible

For risky behavior changes:

- keep the diff small
- use clear helper functions
- avoid hidden side effects
- make fallback behavior explicit
- preserve current working paths unless replacing a proven-bad path

### 6. Update docs when architecture changes

If the task changes call pipeline, prompt assembly, demo/real behavior, or data source of truth, update the relevant doc.

Do not leave docs saying the opposite of the code.

### 7. Tests should target the new source of truth

When adding a helper, add deterministic unit tests if practical.

Test:

- happy path
- edge case
- regression case that caused the bug

Do not build large new test infrastructure unless approved.

---

## Best MVP Fix Principle

When Eric asks for a fix, prefer the best MVP fix:

- not the tiniest patch if it leaves the core bug alive
- not the future enterprise architecture
- the strongest practical fix for a sellable MVP

In reports, avoid long A/B/C menus unless Eric asks. Recommend the best MVP path directly, with tradeoffs.

---

## Current Architecture Notes

### Call Pipeline

The live voice flow uses OpenAI Realtime through browser WebRTC.

High-level flow:

```txt
User starts call
→ /api/voice-session creates ephemeral Realtime session
→ browser WebRTC connects to OpenAI Realtime
→ Realtime emits caller and assistant transcript turns
→ dashboard saves call row + call_messages
→ post-call extraction creates summary / appointment / service request
→ dashboard pages display staff next actions
```

### Transcript source of truth

Realtime transcript turns are the primary source of truth for saved call transcript and post-call extraction.

`calls.transcript` should be assembled from Realtime turns in chronological order:

```txt
Front desk: ...
Caller: ...
Front desk: ...
Caller: ...
```

Rules:

- Preserve conversation order.
- Preserve role labels.
- Drop empty placeholders.
- Drop obvious caller noise/junk using the approved noise helper.
- Never filter assistant turns.
- Do not duplicate turns.

Batch transcription is fallback only when no usable Realtime caller turns were captured.

`/api/transcribe-call` must not overwrite a good Realtime transcript.

### Noise handling

The app uses conservative noisy-call handling.

Principles:

- Background noise alone should not create fake caller turns.
- Empty / punctuation-only / obvious speech-to-text hallucination fragments should be filtered.
- Valid short replies must be preserved:
  - yes / no
  - ok / okay
  - dates
  - times
  - names
  - phone fragments
  - “thank you”
  - “that’s all”

Do not make noise filtering overly aggressive.

### Business local time

The agent must know the business local current date/time at session creation.

Prompt context should include:

- business timezone
- today in business timezone
- current local business time

The assistant should use this for:

- “what time is it right now?”
- “today”
- “tomorrow”
- same-day past-time rejection
- business-hours checks

For MVP, current time is computed once at session creation. Do not build live time refresh unless approved.

The assistant must never ask the caller what the current time is.

---

## Design System

Use the existing FrontDesk design system.

Reuse primitives from `src/app/globals.css` and existing components.

Prefer:

- `fd-card`
- `fd-btn`
- `fd-pill`
- `fd-eyebrow`
- `fd-display`
- `fd-input`
- `StatusBadge`
- existing dashboard shell/chrome

Avoid reintroducing random ad-hoc styling like:

```txt
bg-white rounded-xl shadow
raw hex colors
fixed pixel-heavy layouts
one-off button styles
```

Responsive UI only. Mobile must be designed, not just shrunk desktop.

Full conventions live in `docs/design-system.md`.

---

## Directory Guide

Important areas:

```txt
src/app/                         App Router pages and routes
src/components/                  Shared UI components
src/app/api/voice-session/       Realtime session creation
src/app/dashboard/voice/         Live browser voice test
src/lib/agents/core/             Prompt assembly / global behavior
src/lib/agents/verticals/        Vertical-specific business judgment
src/lib/call-pipeline/           Call transcript, extraction, time, noise helpers
src/lib/supabase/                Supabase clients and business data
tests/voice-agent-evals/         Static eval cases
scripts/                         QA scripts
docs/                            Architecture and workflow docs
```

---

## Workflow

Claude Code is the coder. Eric / ChatGPT are PM and QA.

For each task:

1. Restate the problem briefly.
2. Inspect relevant files.
3. Identify the source of truth.
4. Recommend the best MVP fix.
5. Implement only approved scope.
6. Run required QA.
7. Report exact files changed.
8. Do not commit unless Eric explicitly asks.

### Required final report after implementation

Include:

```txt
1. Files changed
2. Root cause
3. What changed
4. What was intentionally not changed
5. Tests / QA run
6. Build result
7. git status --short
8. Any manual test needed
```

---

## QA Before Commit

Before any commit Eric approves:

- [ ] `npm run build` passes
- [ ] relevant QA scripts pass
- [ ] `git status --short` reviewed
- [ ] only intentional files staged
- [ ] `.env.local` / `.env.*` not staged
- [ ] hook logs not staged
- [ ] no secrets in diff
- [ ] demo mode still works
- [ ] no restaurant-only shared code
- [ ] no obsolete path still overwriting the new source of truth
- [ ] docs updated if architecture changed

---

## Generalized Database Schema

Use generalized table names in shared schema:

```txt
businesses
business_members
business_knowledge
customers
calls
call_messages
appointments
service_requests
profiles
```

Restaurant-specific tables or logic belong only in vertical-specific modules.

---

## Status Language

Useful statuses:

```txt
Needs confirmation
Needs callback
Quote requested
Appointment requested
Resolved
Escalated
Captured
Waiting for staff
Follow-up required
```

Do not use “confirmed” unless the system/business flow truly confirms it.
