-- After-hours daily digest — tracking table + per-call follow-up text.
-- Additive only; no existing data or policies are modified. Run before enabling the digest cron.
--
--   1. calls.next_action  — the extraction's "suggested follow-up", surfaced in the digest.
--   2. call_digests       — one row per business per local day a digest was sent. The cron uses
--                           it to (a) avoid sending twice in a day and (b) know the high-water mark
--                           (covered_through) so the next digest only includes newer calls.
--                           Written ONLY by the server (cron, service role). Members read their own.

alter table public.calls
  add column if not exists next_action text;

create table if not exists public.call_digests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  digest_date date not null,             -- local date (business timezone) the digest covers
  covered_through timestamptz not null,  -- calls with created_at <= this are already reported
  call_count integer not null default 0,
  email_status text,                     -- 'sent' | 'failed' | 'skipped' | 'disabled'
  sms_status text,                       -- 'sent' | 'failed' | 'skipped' | 'disabled'
  sent_at timestamptz not null default now(),
  unique (business_id, digest_date)      -- hard cap: at most one digest per business per local day
);

alter table public.call_digests enable row level security;

-- Members of a business can read that business's digest history (read-only).
create policy "members read own business digests"
  on public.call_digests
  for select
  using (
    business_id in (
      select business_id from public.business_members where user_id = auth.uid()
    )
  );

-- No insert/update/delete policies: only the server (service role) writes, from the digest cron.
