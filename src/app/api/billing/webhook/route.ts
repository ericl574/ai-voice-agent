import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, planForPriceId, subscriptionPeriodEnd } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

// Stripe webhook — the single writer of billing_subscriptions. Signature-verified; processes
// subscription lifecycle events and upserts the business's subscription row using the service
// role (no user session exists on webhook calls; reads stay RLS-protected for users).
//
// Configure in the Stripe dashboard: endpoint {SITE_URL}/api/billing/webhook with events
// checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed.

export const runtime = 'nodejs';

interface SubscriptionRow {
  business_id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  updated_at: string;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    console.error('[FD] billing webhook called but Stripe env vars are missing');
    return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[FD] billing webhook signature verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    // 500 so Stripe retries — the event is not lost while SUPABASE_SERVICE_ROLE_KEY is unset.
    console.error('[FD] billing webhook: SUPABASE_SERVICE_ROLE_KEY missing — cannot persist event', event.type);
    return NextResponse.json({ error: 'Server storage not configured' }, { status: 500 });
  }

  async function upsertRow(row: SubscriptionRow) {
    const { error } = await admin!
      .from('billing_subscriptions')
      .upsert(row, { onConflict: 'business_id' });
    if (error) {
      // Likely the billing migration hasn't run. 500 → Stripe retries.
      throw new Error(`billing_subscriptions upsert failed: ${error.message}`);
    }
  }

  // Resolves which business a subscription belongs to: prefer our metadata, else look up the
  // existing row by Stripe customer id.
  async function businessIdForSubscription(sub: Stripe.Subscription): Promise<string | null> {
    const fromMeta = sub.metadata?.business_id;
    if (fromMeta) return fromMeta;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (!customerId) return null;
    const { data } = await admin!
      .from('billing_subscriptions')
      .select('business_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    return (data?.business_id as string | undefined) ?? null;
  }

  async function applySubscription(sub: Stripe.Subscription, statusOverride?: string) {
    const businessId = await businessIdForSubscription(sub);
    if (!businessId) {
      console.warn('[FD] billing webhook: subscription has no resolvable business_id', sub.id);
      return;
    }
    const priceId = sub.items?.data?.[0]?.price?.id ?? null;
    await upsertRow({
      business_id: businessId,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
      stripe_subscription_id: sub.id,
      plan: planForPriceId(priceId),
      status: statusOverride ?? sub.status,
      current_period_end: subscriptionPeriodEnd(sub),
      updated_at: new Date().toISOString(),
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessId = session.client_reference_id ?? session.metadata?.business_id ?? null;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
        if (businessId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items?.data?.[0]?.price?.id ?? null;
          await upsertRow({
            business_id: businessId,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            plan: planForPriceId(priceId),
            status: sub.status,
            current_period_end: subscriptionPeriodEnd(sub),
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        await applySubscription(event.data.object as Stripe.Subscription, 'canceled');
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const { data } = await admin
            .from('billing_subscriptions')
            .select('business_id')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          if (data?.business_id) {
            await admin
              .from('billing_subscriptions')
              .update({ status: 'past_due', updated_at: new Date().toISOString() })
              .eq('business_id', data.business_id);
          }
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe doesn't retry them.
        break;
    }
  } catch (err) {
    console.error('[FD] billing webhook handler failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
