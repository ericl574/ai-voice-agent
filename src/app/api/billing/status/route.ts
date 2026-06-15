import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { isBillingConfigured } from '@/lib/billing/stripe';

// Billing status for the signed-in user's business — read via the user's own RLS-scoped session
// (members can SELECT their business's billing_subscriptions row; only the server writes it).

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const business = await getActiveBusiness(supabase);
  if (!business) {
    return NextResponse.json({ configured: isBillingConfigured(), subscription: null });
  }

  let subscription = null;
  try {
    const { data } = await supabase
      .from('billing_subscriptions')
      .select('plan, status, current_period_end, stripe_customer_id')
      .eq('business_id', business.id)
      .maybeSingle();
    if (data) {
      subscription = {
        plan: data.plan as string | null,
        status: data.status as string | null,
        currentPeriodEnd: data.current_period_end as string | null,
        hasCustomer: !!data.stripe_customer_id,
      };
    }
  } catch {
    // Table may not exist until the billing migration runs — treat as no subscription.
    subscription = null;
  }

  return NextResponse.json({ configured: isBillingConfigured(), subscription });
}
