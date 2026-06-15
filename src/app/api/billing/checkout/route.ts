import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { getStripe, priceIdForPlan, type PlanId } from '@/lib/billing/stripe';
import { SITE_URL } from '@/lib/site';
import { rateLimit, clientKey } from '@/lib/rate-limit';

// Creates a Stripe Checkout session for a monthly subscription. Auth required; the business is
// resolved server-side (never trusted from the client). Returns { url } for the browser redirect.
// Fails gracefully (503) when Stripe env vars are not configured.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Billing is not enabled on this deployment yet.' },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Please sign in to subscribe.' }, { status: 401 });
  }

  const rl = rateLimit(`billing-checkout:${clientKey(req, user.id)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const business = await getActiveBusiness(supabase);
  if (!business) {
    return NextResponse.json(
      { error: 'Complete business setup before subscribing.' },
      { status: 400 },
    );
  }

  let plan: PlanId = 'starter';
  try {
    const body = await req.json();
    if (body?.plan === 'pro' || body?.plan === 'starter') plan = body.plan;
  } catch {
    // default plan
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: 'This plan is not configured yet.' },
      { status: 503 },
    );
  }

  // Reuse the existing Stripe customer when this business has one (RLS-scoped read; the table
  // may not exist until the billing migration runs — treat any error as "no customer yet").
  let existingCustomerId: string | null = null;
  try {
    const { data } = await supabase
      .from('billing_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', business.id)
      .maybeSingle();
    existingCustomerId = (data?.stripe_customer_id as string | null) ?? null;
  } catch {
    existingCustomerId = null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/dashboard/settings?billing=success`,
      cancel_url: `${SITE_URL}/pricing?billing=cancelled`,
      // business_id travels in metadata so the webhook can attribute the subscription.
      client_reference_id: business.id,
      metadata: { business_id: business.id },
      subscription_data: { metadata: { business_id: business.id } },
      allow_promotion_codes: true,
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: user.email ?? undefined }),
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[FD] billing checkout failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 502 },
    );
  }
}
