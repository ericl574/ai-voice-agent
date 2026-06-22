# Pilot Public-Readiness Checklist

`/contact` now invites real businesses to start a pilot, so the public site must carry a real legal
identity and working email before outreach. This page tracks the identity + config gaps. The phone
turn-on steps live in `docs/pilot-go-live.md`; this is the identity/config layer on top.

## 1. Identity — code (`src/lib/site.ts`)

| Constant | Status | Renders on |
|---|---|---|
| `OPERATOR_NAME` | ✅ `Siran Liu` — sole operator (individual); intentional for the first pilot | `/privacy`, `/terms` ("operated by … in British Columbia, Canada") |
| `SUPPORT_EMAIL` | ✅ `ericliu2364@gmail.com` — personal Gmail; acceptable for the supervised pilot | `/privacy`, `/terms`, `/contact` (mailto) + destination for `/contact` pilot-request emails |
| `OPERATOR_JURISDICTION` | ✅ `British Columbia, Canada` | `/privacy`, `/terms` |
| `LEGAL_LAST_UPDATED` | `June 10, 2026` (bump when legal is finalized) | `/privacy`, `/terms` |

- [x] `OPERATOR_NAME` = `Siran Liu`, operating as an individual/sole operator for the first pilot.
  Intentional — revisit if/when a company or trade name is registered.
- [x] `SUPPORT_EMAIL` = `ericliu2364@gmail.com`. **Acceptable for the supervised first pilot.**
  **Recommend upgrading to a domain support address** (e.g. `support@<your-domain>`) **before broader
  public launch.**
- [ ] Have a lawyer review `/privacy` + `/terms` (PIPEDA / BC PIPA — call transcripts are personal info).

## 2. Required Vercel env (Next app)

| Var | Production value | Why it matters |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` — **https, NO trailing slash** | OG/sitemap, morning-report + reservation links, **and the Twilio signature match** — must EXACTLY equal the Twilio webhook origin or inbound calls return 403 |
| `RESEND_API_KEY` | `re_…` | email delivery (morning report + `/contact` pilot-request notify) |
| `NOTIFY_EMAIL_FROM` | `FrontDesk <alerts@yourdomain>` | verified sender; until set, email skips safely (no-domain mode) |
| `OPS_ALERT_SMS_TO` | `+1…` | operator incident alerts (best-effort; skips if unset) |
| `TWILIO_STREAM_URL` | `wss://<railway-domain>/twilio-stream` | points the inbound webhook at the bridge |

Plus the rest of the phone env (see `docs/pilot-go-live.md` Step 3): `TWILIO_AUTH_TOKEN`,
`TWILIO_BRIDGE_SECRET`, `TWILIO_BUSINESS_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`CRON_SECRET`. (`OPENAI_API_KEY` must be on the app **and** the bridge.)

## 3. Required Railway env (bridge)

| Var | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-…` |
| `TWILIO_BRIDGE_SECRET` | same value as the Vercel app |
| `FD_APP_URL` | `https://<your-vercel-domain>` |
| `OPENAI_REALTIME_MODEL` / `TWILIO_TRANSCRIPTION_MODEL` | optional overrides |

Healthcheck path `/health`; keep crash-restart on. The bridge's public URL → the app's
`TWILIO_STREAM_URL`.

## 4. `/contact` pilot requests — required before public use

The form posts to `/api/pilot-request`:
- **Email configured** (`RESEND_API_KEY` + `NOTIFY_EMAIL_FROM`) → emailed to `SUPPORT_EMAIL`.
- **Not configured** → logged server-side **only**, as a temporary fallback. Server logs rotate/expire —
  **not durable lead storage**, leads can be lost.

**Required before public use:** `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` + a real `SUPPORT_EMAIL`
(or add DB lead storage).

## 5. Final go-live gate

- [ ] **Real phone-call test** end-to-end (`docs/pilot-go-live.md` Steps 1–5): the call lands in Call
  History with a real summary; no `extraction_skipped_no_api_key` in logs.
- [ ] Manual digest trigger sends the morning report + CSV.
- [ ] `npm run build`, `qa:units`, `qa:call-pipeline` pass on the deploy commit.
