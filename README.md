# FrontDesk

A virtual front desk for local service businesses. FrontDesk answers customer calls, uses the
business's own knowledge, logs appointment and service requests, and gives staff a single
dashboard to review and confirm them.

**Supported business types:** Restaurants, Auto Repair, Salons & Spas, Clinics, Tutoring Centers, Home Services, and more.

## Tech Stack

- **Next.js 16** (App Router, `src/` directory, TypeScript strict mode)
- **Tailwind CSS v4**
- **Supabase** — Auth + Postgres + Row Level Security
- **OpenAI Realtime API** — browser voice (WebRTC, server-side key)

## Pages

| Route | Description |
|---|---|
| `/` | Landing page (includes the public "Try Our Service" live call demo) |
| `/pricing` | Plans + Stripe Checkout (graceful when billing env is unset) |
| `/privacy`, `/terms`, `/contact` | Legal & support pages (draft content — placeholders in `src/lib/site.ts`) |
| `/login`, `/signup`, `/reset-password` | Auth (email + password, with password reset) |
| `/onboarding` | New business setup |
| `/dashboard` | Overview with stats and priority actions |
| `/dashboard/voice` | Browser test call (OpenAI Realtime API; sign-in required) |
| `/dashboard/calls` | Full call history with expandable transcripts |
| `/dashboard/reservations` | Appointment requests (Confirm / Decline) |
| `/dashboard/orders` | Service requests (Confirm / Decline) |
| `/dashboard/knowledge` | Knowledge base editor |
| `/dashboard/settings` | Business & front desk settings |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

All dashboard pages work in **demo mode** (mock data) without any environment setup. Sign in and
complete onboarding to use real data. The dashboard test call requires sign-in; the landing-page
demo call works without an account.

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

Required for live voice calls via OpenAI Realtime API (Realtime API access must be enabled on the
key). The app runs fully without it — the voice page shows a setup guide when the key is missing.

### Optional (deployment)

```
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Used for Open Graph metadata, robots, and the sitemap. Defaults to `http://localhost:3000`.

### Optional (Stripe billing — see docs/stripe-setup.md)

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
SUPABASE_SERVICE_ROLE_KEY=...   # server-only; webhook + phone-call save
```

Without these, `/pricing` renders and billing surfaces show a friendly "not enabled" state.

### Optional (Twilio real phone line — see docs/twilio-setup.md)

```
TWILIO_AUTH_TOKEN=...                              # webhook signature validation
TWILIO_STREAM_URL=wss://bridge-host/twilio-stream  # where the media bridge runs
TWILIO_BRIDGE_SECRET=...                           # shared app ↔ bridge secret
TWILIO_BUSINESS_ID=...                             # which business answers the line (optional)
```

The media bridge (`server/twilio-bridge.ts`, `npm run twilio:bridge`) runs as a separate
always-on Node process — Vercel serverless cannot host Twilio Media Streams WebSockets.

For password reset emails, the deployed URL must also be added to the Supabase Auth
**redirect URL allowlist**, and the recovery email template should link to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update`.

## Development

```bash
npm run dev               # Start dev server on http://localhost:3000
npm run build             # Production build — run before every commit
npm run lint              # Lint check
npm run qa:units          # Deterministic unit tests (pure helpers)
npm run qa:call-pipeline  # Deterministic call-pipeline tests
```

## QA Checklist (before committing)

- [ ] `npm run build` passes with zero errors
- [ ] `npm run qa:units` and `npm run qa:call-pipeline` pass
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
| `businesses` | Business profiles and front desk config |
| `business_members` | Staff access (owner / staff roles) |
| `business_knowledge` | Q&A entries the front desk uses to answer callers |
| `calls` | Call records |
| `call_messages` | Individual transcript messages per call |
| `appointments` | Appointment requests (always pending until staff confirms) |
| `service_requests` | Service and order requests |

## Important Constraints

- **Appointments are always pending until staff confirms.** The front desk never claims a booking is confirmed.
- **OpenAI API key stays server-side only.** The browser receives only an ephemeral token from `/api/voice-session`.
- **Voice session minting requires sign-in or the landing-demo flag** — anonymous non-demo requests are rejected.
- **Realtime model:** configured in `src/app/api/voice-session/route.ts` — do not change without explicit approval.
- **No Twilio, Retell, Vapi, or external phone platforms** — voice is browser-only for MVP.
- Customer-facing brand is **FrontDesk** (see `docs/product-scope.md` for language rules); site identity constants live in `src/lib/site.ts`.
