@AGENTS.md

# Restaurant AI Voice Agent — Project Rules

## Product
Restaurant AI Voice Agent is a mock-data SaaS demo of an AI phone assistant for restaurants. It helps answer common customer questions and collect reservation/order requests for staff review.

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
1. **Reservations and orders default to "pending staff confirmation".** The AI must never claim bookings are confirmed. Always show the pending disclaimer.
2. **Inspect before editing.** Never guess file structure — read files first.
3. **No unnecessary dependencies.** Leverage Tailwind and Next.js built-ins.
4. **Responsive UI.** No fixed pixel-heavy layouts. Use Tailwind responsive classes.
5. **Server components by default.** Only add "use client" where state/hooks are needed.
6. **Mock data only.** All data comes from `src/lib/mock-data.ts`. No API calls.

## Navigation Structure
- `/` — Landing page
- `/dashboard` — Dashboard overview
- `/dashboard/simulator` — AI Call Simulator
- `/dashboard/calls` — Call History
- `/dashboard/reservations` — Reservation Requests
- `/dashboard/orders` — Order Requests
- `/dashboard/knowledge` — Knowledge Base
- `/dashboard/settings` — Settings

## Status Colors
- pending → amber
- confirmed → green
- declined → red
- resolved → green
- escalated → red
- missed → gray
