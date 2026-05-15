# FrontDesk AI

AI voice agent platform for service businesses. An AI phone assistant answers every call, logs appointment and service requests, and gives staff a single dashboard to review and confirm them.

This is an MVP demo with mock data — no real calls, no real AI, no backend. **Restaurants are the first demo vertical**; the platform is designed to support any service business (auto repair, salons, clinics, tutoring centers, home services, and more).

## Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/dashboard` | Overview with stats and recent calls |
| `/dashboard/simulator` | AI call simulator with step-by-step chat |
| `/dashboard/calls` | Full call history table |
| `/dashboard/reservations` | Reservation/appointment requests (Confirm / Decline) |
| `/dashboard/orders` | Order/service requests (Confirm / Decline) |
| `/dashboard/knowledge` | Knowledge base editor |
| `/dashboard/settings` | Business & AI assistant settings |

## Tech Stack

- Next.js 15 (App Router, TypeScript)
- Tailwind CSS v4
- Supabase (auth foundation — Phase 2)
- Mock data only (`src/lib/mock-data.ts`)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
