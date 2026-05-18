# FrontDesk AI

AI voice agent platform for local service businesses. An AI front desk assistant answers every call, logs appointment and service requests, and gives staff a single dashboard to review and confirm them.

**Supported business types:** Restaurants, Auto Repair, Salons & Spas, Clinics, Tutoring Centers, Home Services, and more.

## Tech Stack

- **Next.js 16** (App Router, `src/` directory, TypeScript strict mode)
- **Tailwind CSS v4**
- **Supabase** — Auth + Postgres + Row Level Security
- **OpenAI Realtime API** — browser voice prototype (WebRTC, server-side key)

## Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/dashboard` | Overview with stats and recent activity |
| `/dashboard/voice` | Browser voice agent (OpenAI Realtime API) |
| `/dashboard/simulator` | AI call simulator |
| `/dashboard/calls` | Full call history with expandable transcripts |
| `/dashboard/reservations` | Appointment requests (Confirm / Decline) |
| `/dashboard/orders` | Service requests (Confirm / Decline) |
| `/dashboard/knowledge` | Knowledge base editor |
| `/dashboard/settings` | Business & AI agent settings |
| `/onboarding` | New business setup |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

All dashboard pages work in **demo mode** (mock data) without any environment setup. Sign in and complete onboarding to use real data.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values. **`.env.local` must never be committed** — it is covered by `.gitignore`.

### Required (auth + database)

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Without these, the app runs in demo mode with mock data. No crashes.

### Optional (browser voice agent)

```
OPENAI_API_KEY=sk-...
```

Required for live voice calls via OpenAI Realtime API (Realtime API access must be enabled on the key). The app runs fully without it — the Voice Agent page shows a setup guide when the key is missing.

## Development

```bash
npm run dev      # Start dev server on http://localhost:3000
npm run build    # Production build — run before every commit
npm run lint     # Lint check
```

## QA Checklist (before committing)

- [ ] `npm run build` passes with zero errors
- [ ] `git status --short` reviewed — only intentional files staged
- [ ] `.env.local` is NOT staged
- [ ] No secret keys or tokens appear in the diff
- [ ] Signed-out demo mode works (all pages accessible without auth)
- [ ] Pending disclaimer visible on appointment/service request flows
- [ ] No restaurant-only language in shared UI or schema

## Database Schema

Managed in Supabase. RLS is enforced on all tables — never bypass it or use the service-role key in client code.

| Table | Description |
|---|---|
| `businesses` | Business profiles and AI agent config |
| `business_members` | Staff access (owner / staff roles) |
| `business_knowledge` | Q&A entries the AI uses to answer callers |
| `calls` | Call records |
| `call_messages` | Individual transcript messages per call |
| `appointments` | Appointment requests (always pending until staff confirms) |
| `service_requests` | Service and order requests |

## Important Constraints

- **Appointments are always pending until staff confirms.** The AI never claims a booking is confirmed.
- **OpenAI API key stays server-side only.** The browser receives only an ephemeral token from `/api/voice-session`.
- **Voice model:** `gpt-realtime-mini` — do not upgrade without explicit approval.
- **No Twilio, Retell, Vapi, or external phone platforms** — voice is browser-only for MVP.
