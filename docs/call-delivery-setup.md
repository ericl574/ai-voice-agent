# Call Delivery — Setup Guide (SMS + email alerts to the business)

> **MVP-default delivery is the daily after-hours report**, not per-call alerts. The owner's main
> deliverable is one daily email report + CSV (optional short SMS) — see `docs/after-hours-report.md`.
> The **per-call** instant SMS/email described here is an **optional** mode (`delivery_mode =
> instant_*`), **off by default**. This guide is the external provider setup that both the digest and
> the optional per-call modes share (Twilio + Resend).

Per-call Call Delivery (when enabled) sends, after every non-demo completed call, the caller's
details by **text and/or email** — no need to open the dashboard. The dashboard stays
history/settings/archive either way.

The code path is complete and shared by the same post-call core for both browser test calls and
Twilio phone calls. Note the **browser voice line is the default test surface**; real Twilio phone
calls require a **deployed/verified Twilio bridge** (`docs/twilio-setup.md`) and are not
production-verified by default — don't promise production phone service before manual verification.
This guide is the external provider setup.

## How it works

- Both `/api/post-call` (browser) and `/api/twilio/post-call` (phone) call
  `runPostCallExtraction()` in `src/lib/call-pipeline/postCallCore.ts`.
- After the call is saved and any appointment/service request is created, it calls
  `deliverCallNotifications()` (`src/lib/notify/callDelivery.ts`) in a guarded block — **delivery
  can never block or fail the save.**
- A channel sends only when the owner **enabled** it in Settings **and** a destination exists
  (the explicit field, or the business's own phone/email as fallback).
- **Demo calls never reach the post-call core**, so they never send notifications.

## What the business owner does (in-app, no env needed)

The visible Settings surface is **After-hours report** (the daily digest — see
`docs/after-hours-report.md`): toggle the email report and/or the optional SMS alert, optionally set
a destination (blank uses the business email/phone on file), and save.

The **per-call** instant modes described here have **no dedicated UI in the MVP** — they are an
optional config mode (`agent_config.delivery_mode = instant_all` / `instant_action_needed`), off by
default. Destinations and provider behavior are shared with the digest; only the trigger differs.

## Provider setup (deployment env vars — server-side only)

Delivery is enabled by the owner's toggle, but a channel only actually sends if the deployment has
that provider configured. If env vars are missing, the channel logs `skipped — provider not
configured` and the call still saves fine.

### SMS — Twilio Programmable Messaging

```
TWILIO_ACCOUNT_SID=AC…        (Twilio Console → Account Info)
TWILIO_AUTH_TOKEN=…           (same token already used for inbound webhook signatures)
TWILIO_PHONE_NUMBER=+1…       (an SMS-capable Twilio number — the "from")
```

Notes:
- On a Twilio **trial**, you can only text **verified** numbers, and messages carry a trial prefix.
- US/Canada A2P 10DLC registration is required for production volume (not for a quick test).

### Email — Resend (recommended fastest path)

```
RESEND_API_KEY=re_…
NOTIFY_EMAIL_FROM=FrontDesk <alerts@yourdomain.com>
```

Notes:
- For real sending you must verify your domain in Resend (add the DNS records it gives you).
- For a quick test, Resend's onboarding sender can deliver to your own address.

(Alternative: SendGrid works too — it's also a single REST call — but Resend is the lower-friction
path. If you switch, only `src/lib/notify/email.ts` changes.)

## Acceptance test

1. Set the SMS and/or email env vars above in Vercel; redeploy.
2. Enable a per-call instant mode (`agent_config.delivery_mode = instant_*`) for the test business.
3. Place a **signed-in browser** test call (or a real Twilio call once that's live), book something,
   hang up.
4. Expect: a text and/or email with the caller, summary, and the appointment/request, plus a link
   to Call History. Server logs show `[FD] delivery sms → sent` / `email → sent`.
5. A **demo** call (signed-out) sends nothing — confirm no message arrives.

## Honest limitations

- Delivery status is in **server logs** only (`[FD] delivery …`); there is no in-dashboard delivery
  log table yet (intentional — keeps the dashboard as history/settings/archive).
- One destination per channel per business (plus the fallback). No per-staff routing yet.
- No retry/queue: a failed send is logged, not retried (the call is always safely saved).
