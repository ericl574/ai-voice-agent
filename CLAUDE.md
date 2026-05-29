# FrontDesk AI — Claude Code Project Guide

> **Detailed references** (keep this file lean — route depth here):
> - Design system & UI conventions → `docs/design-system.md`
> - Call pipeline architecture → `docs/call-pipeline.md`
> - AI collaboration workflow → `docs/ai-collaboration-workflow.md`

## Product Vision

FrontDesk AI is a SaaS platform for AI voice agents serving local service businesses. It answers
common customer questions and collects appointment/service requests for staff review.

**This platform must NOT be restaurant-only.** Restaurants are the first demo vertical only.
The platform supports: restaurants, auto repair, salons/spas, clinics, tutoring centers,
home services, and other local service businesses.

Supported `business_type` values: `restaurant | auto_repair | salon | clinic | tutoring | home_services | other`

## Architecture

### Tech Stack
- **Next.js 16** (App Router, `src/` directory, `@/*` alias)
- **TypeScript** (strict mode)
- **Tailwind CSS v4**
- **Supabase** — Auth + Postgres + Row Level Security
- **OpenAI Realtime API** — browser voice (direct WebRTC, server-side key) + Whisper transcription

### Design System
Apple-inspired "Studio Modernist" look defined in `src/app/globals.css`: Apple system fonts
(SF Pro / SF Mono via `--font-display/-body/-mono`), neutral gray palette (`--paper #F5F5F7`,
`--ink #1D1D1F`, warm `--accent #D04F1A`, status tokens), and `fd-*` primitive classes
(`fd-card`, `fd-btn*`, `fd-pill*`, `fd-eyebrow`, `fd-display`, `fd-tab*`, `fd-input`,
`fd-stagger`). Reuse these primitives — don't reintroduce ad-hoc `bg-white rounded-xl shadow`
patterns or raw hexes. **Full conventions: `docs/design-system.md`.**

### Call Pipeline
- Session (`/api/voice-session`) sets conservative server VAD (`threshold 0.65`,
  `silence_duration_ms 1000`) + per-turn caller transcription (`audio.input.transcription`) using
  `gpt-realtime-whisper` with a soft `language: 'en'` hint. Transcription model + language
  constants live in `src/lib/call-pipeline/constants.ts`.
- Realtime events → per-turn `TranscriptEntry`s; `saveCall` writes one `call_messages` row per
  turn (caller + assistant). Caller turns are **single-source** (OpenAI server-side transcription
  only — browser SpeechRecognition was removed; it duplicated turns and mislabeled assistant echo).
- `/api/transcribe-call` transcribes the caller recording with `gpt-4o-transcribe` (+ `en` hint)
  and writes `calls.transcript` — the source of truth for extraction; it does NOT insert a caller
  row (avoids duplicating per-turn rows).
- `/api/post-call` extracts intent (appointment wins over service request; phone optional;
  appointments default pending). **Full architecture: `docs/call-pipeline.md`.**

### Directory Layout
- `src/app/` — App Router pages and layouts
- `src/components/` — Shared UI components
- `src/lib/supabase/client.ts` — browser Supabase client, exports `isSupabaseConfigured`
- `src/lib/supabase/server.ts` — async server client using Next.js `cookies()`
- `src/lib/mock-data.ts` — mock data for demo/signed-out mode
- `src/proxy.ts` — refreshes Supabase session on every request; skips if env vars missing
- `src/app/api/voice-session/route.ts` — server-side ephemeral token endpoint (Phase 5)
- `src/app/dashboard/voice/` — browser voice prototype page (Phase 5)

### Required Env Vars
See `.env.example`. Never commit `.env.local` (covered by `.gitignore` via `.env*`).
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY` — server-side only, never exposed to browser

## Navigation
- `/` — Landing page
- `/dashboard` — Overview
- `/dashboard/voice` — Live browser voice test ("Test the call")
- `/dashboard/simulator` — AI Call Simulator (mock)
- `/dashboard/calls` — Call History
- `/dashboard/reservations` — Appointment Requests
- `/dashboard/orders` — Service Requests
- `/dashboard/knowledge` — Knowledge Base
- `/dashboard/settings` — Settings

## Current Project State (2026-05-28)

- **Live browser voice works and is under active QA** — `OPENAI_API_KEY` is configured; real
  calls produce transcripts and create pending appointments.
- **Call pipeline tuned** — conservative server VAD + per-turn caller transcription; both
  caller and Front desk turns saved as separate `call_messages` rows; Whisper still produces
  the official `calls.transcript` for extraction. See `docs/call-pipeline.md`.
- **UI redesigned** to the Apple "Studio Modernist" system (`docs/design-system.md`):
  - **Done:** Overview, Call History (date-grouped cards + avatars + stat strip), Appointments
    (full-width cards), Service Requests (full-width cards), Voice test page, shared chrome
    (Sidebar / DemoBanner / StatusBadge), `globals.css`.
  - **Partial:** Knowledge / Settings / Simulator — primitives applied (cards/buttons/hairlines)
    but page headers not yet brought to the `fd-display` treatment.
  - **Not started:** landing `/`, auth (`/login`, `/signup`, `/onboarding`). Leave the landing
    `HeroVideoPlaylist` video loop intact.
- **Uncommitted** — the redesign + pipeline work is in the working tree only (HEAD is the
  pre-redesign baseline). Commit only when Eric asks.

---

## Permanent Safety Rules

### Secret & Credential Safety
1. **Never read, print, cat, grep, edit, or stage `.env.local` or any `.env.*` file.**
2. **Never print or log `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or any secret value.**
3. **Never use the Supabase service-role key in frontend code or any client-accessible code path.**
4. **Never bypass Row Level Security (RLS)** in any query or migration.
5. The **OpenAI API key must remain server-side only.** The browser receives only an ephemeral
   client secret from `/api/voice-session` — never the raw key.

### Database Safety
6. **Never run destructive database commands** (`supabase db reset`, `DROP TABLE`, `TRUNCATE`,
   schema-destructive `psql` commands) without explicit Eric approval.
7. Use `business_id`-scoped queries. Never return unscoped cross-business data.
8. Maintain existing RLS policies. Do not disable or work around them.

### Git Safety
9. **Never run destructive git commands** (`git reset --hard`, `git clean -fd`,
   `git push --force`) without explicit Eric approval.
10. **Never commit unless Eric explicitly asks.**
11. Before any commit Eric approves: run `npm run build` and confirm it passes cleanly.
12. Check `git status --short` before and after meaningful changes.
13. `.env.local` must never be staged — it is in `.gitignore` via `.env*`.

### Product Safety
14. **Keep the platform generalized for all service businesses.** Never hard-code
    restaurant-only concepts into shared UI, schema, or copy.
15. **Reservations and bookings always default to "pending staff confirmation."**
    The AI must never claim they are confirmed. The pending disclaimer must always be visible.
16. **Keep signed-out demo mode working.** All dashboard pages must be accessible without auth.
    All auth flows guard with `isSupabaseConfigured` — the app must not crash without `.env.local`.

### Voice Agent Safety
17. Use `gpt-realtime-mini` for MVP unless
    Eric approves another model. Do not silently upgrade to a more expensive model.
18. **Do not add Retell, Vapi, Twilio, or any other voice platform** without Eric's approval.
19. The voice page must handle a missing `OPENAI_API_KEY` gracefully — show an error state,
    never crash or expose the missing-key error in a way that leaks config details.

### Code Safety
20. **Inspect before editing.** Read files first — never guess file structure.
21. Server components by default. Only add `"use client"` where state/hooks are needed.
22. No unnecessary dependencies. Use Tailwind and Next.js built-ins.
23. Responsive UI only. No fixed pixel-heavy layouts — use Tailwind responsive classes.
24. Prefer safe, focused, minimal changes. Do not refactor beyond what the task requires.

---

## Workflow
- **Claude** = coder
- **Eric / ChatGPT** = PM / QA
- Prefer safe, focused, minimal changes
- Do not commit unless Eric explicitly asks
- Run `git status --short` before and after meaningful changes
- Do not add features or refactor beyond the current task scope

## QA-Before-Commit Checklist
Before any commit Eric approves, verify all of these:
- [ ] `npm run build` passes with zero errors
- [ ] `git status --short` reviewed — only intentional files staged
- [ ] `.env.local` is NOT staged
- [ ] No secret keys or tokens appear in the diff
- [ ] Signed-out demo mode still works (all pages accessible)
- [ ] Pending disclaimer visible on reservation/booking flows
- [ ] No restaurant-only language in shared UI or schema

---

## Generalized Database Schema
Use these table names in shared schema — avoid restaurant-only names:
- `businesses`, `business_members`, `business_knowledge`
- `customers`, `calls`, `call_messages`
- `appointments`, `service_requests`

Restaurant-specific tables (e.g. `menu_items`) belong in a vertical-specific module only.

## Status Colors
Implemented via `fd-pill` variants (`StatusBadge.tsx` → `docs/design-system.md`):
- pending → amber (`fd-pill-warn`)
- confirmed → green (`fd-pill-ok`)
- declined → red (`fd-pill-danger`)
- resolved → green (`fd-pill-ok`)
- escalated → red (`fd-pill-danger`)
- missed → gray (`fd-pill-muted`)
