import Stripe from 'stripe';

// Server-only Stripe helper. The secret key never reaches the browser; routes that import this
// must stay server-side. All functions degrade gracefully when billing env vars are missing so
// the app runs fine without Stripe configured (demo/pilot mode).
//
// Required env vars (see docs/stripe-setup.md):
//   STRIPE_SECRET_KEY      — sk_test_… / sk_live_…
//   STRIPE_WEBHOOK_SECRET  — whsec_… (webhook route only)
//   STRIPE_PRICE_STARTER   — price_… id of the Starter monthly plan
//   STRIPE_PRICE_PRO       — price_… id of the Pro monthly plan

export type PlanId = 'starter' | 'pro';

export const PLANS: Record<PlanId, { name: string; priceEnvVar: string }> = {
  starter: { name: 'Starter', priceEnvVar: 'STRIPE_PRICE_STARTER' },
  pro: { name: 'Pro', priceEnvVar: 'STRIPE_PRICE_PRO' },
};

export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let stripeSingleton: Stripe | null = null;

/** Returns the Stripe client, or null when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeSingleton;
}

/** Resolves a plan's Stripe price id from env; null when not configured. */
export function priceIdForPlan(plan: PlanId): string | null {
  return process.env[PLANS[plan].priceEnvVar] ?? null;
}

/** Maps a Stripe price id back to our plan id (for webhook updates); null when unknown. */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  return null;
}

/**
 * Extracts the current period end as an ISO string from a subscription, tolerating both API
 * shapes (older: on the subscription; Basil 2025+: on the subscription item).
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const epoch =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;
  return epoch ? new Date(epoch * 1000).toISOString() : null;
}
