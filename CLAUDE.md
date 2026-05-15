@AGENTS.md

# FrontDesk AI — Project Rules

## Product
FrontDesk AI is a mock-data SaaS demo of an AI voice agent platform for service businesses. It answers common customer questions and collects appointment/service requests for staff review. Restaurants are the **first demo vertical** — the platform must remain generalized and not become restaurant-only.

## MVP Scope (what NOT to build yet)
- No real phone calls or Twilio integration
- No Supabase or real database
- No real AI/LLM integration
- No authentication or payments

## Tech Stack
- Next.js (App Router, src/ directory, @/* alias)
- TypeScript (strict mode)
- Tailwind CSS v4
- ESLint

## Architecture
- `src/app/` — App Router pages and layouts
- `src/components/` — Shared UI components
- `src/lib/mock-data.ts` — Single source of truth for all mock data

## Critical Rules
1. **This platform must not be restaurant-only.** Restaurants are the first demo vertical. All copy, naming, and schema must remain generalized for any service business. Never hard-code restaurant-only concepts into shared UI or database schema.
2. **Reservations and orders default to "pending staff confirmation".** The AI must never claim bookings are confirmed. Always show the pending disclaimer.
3. **Inspect before editing.** Never guess file structure — read files first.
4. **No unnecessary dependencies.** Leverage Tailwind and Next.js built-ins.
5. **Responsive UI.** No fixed pixel-heavy layouts. Use Tailwind responsive classes.
6. **Server components by default.** Only add "use client" where state/hooks are needed.
7. **Mock data only.** All data comes from `src/lib/mock-data.ts`. No API calls.

## Navigation Structure
- `/` — Landing page
- `/dashboard` — Dashboard overview
- `/dashboard/simulator` — AI Call Simulator
- `/dashboard/calls` — Call History
- `/dashboard/reservations` — Reservation/Appointment Requests
- `/dashboard/orders` — Order/Service Requests
- `/dashboard/knowledge` — Knowledge Base
- `/dashboard/settings` — Settings

## Phase 2 — Auth Foundation (added 2026-05-15)

- `@supabase/supabase-js` + `@supabase/ssr` installed
- `src/lib/supabase/client.ts` — browser client, exports `isSupabaseConfigured`
- `src/lib/supabase/server.ts` — async server client using Next.js `cookies()`
- `src/middleware.ts` — refreshes Supabase session on every request; skips gracefully if env vars missing
- `src/app/login/page.tsx` + `src/app/signup/page.tsx` — email/password auth forms
- Dashboard layout checks session server-side; shows `DemoBanner` when not signed in
- Sidebar shows user email + sign-out button when signed in; shows "Sign in →" link otherwise
- All auth flows guard with `isSupabaseConfigured` — app never crashes when `.env.local` is absent
- Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`)
- Do NOT commit `.env.local` (already in `.gitignore` via `.env*`)
- Mock data pages remain fully accessible without auth (demo mode)

## Generalized Database Naming (for future schema work)
Use these table names — avoid restaurant-only names in shared schema:
- `businesses`
- `business_members`
- `business_knowledge`
- `customers`
- `calls`
- `call_messages`
- `appointments`
- `service_requests`

Restaurant-specific tables (e.g. `menu_items`) belong in a vertical-specific module, not the core schema.

## Supported Business Types
`restaurant` | `auto_repair` | `salon` | `clinic` | `tutoring` | `home_services` | `other`

## Status Colors
- pending → amber
- confirmed → green
- declined → red
- resolved → green
- escalated → red
- missed → gray
