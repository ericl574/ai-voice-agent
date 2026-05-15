# Restaurant AI Voice Agent

AI-powered phone assistant for restaurants. This is an MVP demo with mock data — no real calls, no real AI, no backend.

## Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/dashboard` | Overview with stats and recent calls |
| `/dashboard/simulator` | AI call simulator with step-by-step chat |
| `/dashboard/calls` | Full call history table |
| `/dashboard/reservations` | Reservation requests (Confirm / Decline) |
| `/dashboard/orders` | Order requests (Confirm / Decline) |
| `/dashboard/knowledge` | Knowledge base editor |
| `/dashboard/settings` | Restaurant & AI assistant settings |

## Tech Stack

- Next.js 15 (App Router, TypeScript)
- Tailwind CSS v4
- Mock data only (`src/lib/mock-data.ts`)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
