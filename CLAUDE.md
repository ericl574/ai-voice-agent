@AGENTS.md

# FrontDesk AI — Claude Code Project Guide

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
- **OpenAI Realtime API** — browser voice prototype (direct WebRTC/WebSocket, server-side key)

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
- `/dashboard/voice` — Browser voice prototype (Phase 5, uncommitted)
- `/dashboard/simulator` — AI Call Simulator (mock)
- `/dashboard/calls` — Call History
- `/dashboard/reservations` — Appointment Requests
- `/dashboard/orders` — Service Requests
- `/dashboard/knowledge` — Knowledge Base
- `/dashboard/settings` — Settings

## Current Project State (2026-05-18)

- **Committed through Phase 5** — Browser voice prototype committed (f40c6d9).
  - `src/app/api/voice-session/route.ts` — server-side ephemeral token endpoint
  - `src/app/dashboard/voice/page.tsx` — voice UI with full lifecycle handling
  - `src/components/Sidebar.tsx` — includes Voice Agent nav link
- **Phase 6 in progress** — Professional voice agent hardening.
  - Readiness checklist, connection timeout, WebRTC failure states, mic error UX, save clarity.
  - Live voice QA is pending OpenAI API billing setup — page is polished without a key.
- **Live voice QA blocked** — `OPENAI_API_KEY` billing not yet enabled. Do not test live voice.

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
- pending → amber
- confirmed → green
- declined → red
- resolved → green
- escalated → red
- missed → gray
