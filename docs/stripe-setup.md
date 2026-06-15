# Stripe Billing — Setup Guide (test mode first)

The code path is complete; this is the external setup. Total time ≈ 20 minutes.

## 1. Run the billing migration (Supabase)

In the Supabase SQL editor, run `supabase/migrations/20260611000000_billing_subscriptions.sql`.
It creates one additive table, `billing_subscriptions` (one row per business), with RLS:
business members can **read** their own row; **only the server writes** (via the service role,
from the webhook). No existing tables or policies are touched.

## 2. Create products & prices (Stripe dashboard, test mode)

1. Products → Add product: **FrontDesk Starter**, recurring monthly price (e.g. $49 CAD).
2. Products → Add product: **FrontDesk Pro**, recurring monthly price (e.g. $99 CAD).
3. Copy each **price id** (`price_…`).
4. The amounts on `/pricing` (`src/app/pricing/page.tsx`) are display placeholders — keep them
   in sync with whatever you set in Stripe.

## 3. Configure the webhook

Stripe dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://<your-domain>/api/billing/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Copy the **signing secret** (`whsec_…`).

For local testing instead: `stripe listen --forward-to localhost:3000/api/billing/webhook`
(the CLI prints a temporary `whsec_…`).

## 4. Environment variables (Vercel → Project → Settings → Environment Variables)

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_STARTER=price_…   (Starter monthly price id)
STRIPE_PRICE_PRO=price_…       (Pro monthly price id)
SUPABASE_SERVICE_ROLE_KEY=…    (server-only; the webhook needs it to write subscription rows)
NEXT_PUBLIC_SITE_URL=https://<your-domain>
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only — it is used exclusively by
`src/lib/supabase/admin.ts` (webhook + Twilio save path) and must never get a `NEXT_PUBLIC_`
prefix.

## 5. Acceptance test (Stripe test mode)

1. Sign in to a real account with a business → `/pricing` → "Start with Starter".
2. Pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
3. You land back on `/dashboard/settings?billing=success`; the **Plan & Billing** card shows
   "Starter plan · Active" (give the webhook a few seconds; refresh once).
4. Click **Manage billing** → Stripe Customer Portal opens (test cancel/update there).
5. Stripe dashboard → Webhooks → confirm deliveries are `200`.

## Behavior without setup

Everything degrades gracefully: with no `STRIPE_SECRET_KEY`, `/pricing` renders, checkout
returns a friendly 503 message, the settings card says billing isn't enabled, and the webhook
returns 503. Nothing crashes.

## Not implemented yet (deliberately)

- Plan **enforcement** (feature gating/usage limits) — status is stored and displayed only.
- Live-mode keys, taxes, coupons beyond promo codes, per-seat pricing.
