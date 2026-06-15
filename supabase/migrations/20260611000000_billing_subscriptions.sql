-- Billing subscriptions — one row per business, written ONLY by the server (Stripe webhook /
-- checkout flow via the service role). Business members can read their own business's row;
-- no user-level insert/update/delete policies exist on purpose.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) BEFORE enabling Stripe billing.
-- It is additive only: no existing tables or policies are modified.

create table if not exists public.billing_subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  plan text,                       -- 'starter' | 'pro' (null until first checkout)
  status text,                     -- Stripe subscription status: active | trialing | past_due | canceled | …
  current_period_end timestamptz,  -- end of the current paid period
  updated_at timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;

-- Members of a business can see that business's subscription (read-only).
create policy "members read own business subscription"
  on public.billing_subscriptions
  for select
  using (
    business_id in (
      select business_id from public.business_members where user_id = auth.uid()
    )
  );

-- No insert/update/delete policies: only the server (service role, which bypasses RLS by design)
-- writes rows, from the Stripe webhook and checkout flow.
