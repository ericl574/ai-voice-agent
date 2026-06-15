import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { getStripe } from '@/lib/billing/stripe';
import { SITE_URL } from '@/lib/site';
import { rateLimit, clientKey } from '@/lib/rate-limit';

// Opens the Stripe Customer Portal (manage plan, payment method, cancel, invoices).
// Auth required; the customer id comes from the business's RLS-readable subscription row.

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
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  }

  const rl = rateLimit(`billing-portal:${clientKey(req, user.id)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const business = await getActiveBusiness(supabase);
  if (!business) {
    return NextResponse.json({ error: 'No business profile found.' }, { status: 400 });
  }

  let customerId: string | null = null;
  try {
    const { data } = await supabase
      .from('billing_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', business.id)
      .maybeSingle();
    customerId = (data?.stripe_customer_id as string | null) ?? null;
  } catch {
    customerId = null;
  }

  if (!customerId) {
    return NextResponse.json(
      { error: 'No billing account yet — choose a plan first.' },
      { status: 404 },
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/dashboard/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[FD] billing portal failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Could not open the billing portal. Please try again.' },
      { status: 502 },
    );
  }
}
