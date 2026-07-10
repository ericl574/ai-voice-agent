-- Durable pilot lead storage — every /contact submission is persisted here (source of truth),
-- so a lead is never lost to an unconfigured or failed notification email.
-- Additive only; no existing data or policies are modified.
--
-- Written ONLY by the server (the /api/pilot-request route, service role). No user-facing reads:
-- RLS is enabled with NO policies, so normal/anon clients can neither read nor write it — the
-- founder reads leads via the Supabase console / service role.

create table if not exists public.pilot_requests (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text,
  business_type text not null default 'other',
  city text,
  message text,
  source text not null default 'contact_form', -- where the lead came from
  created_at timestamptz not null default now()
);

-- Newest-first lookups for the founder reviewing inbound leads.
create index if not exists pilot_requests_created_at_idx
  on public.pilot_requests (created_at desc);

alter table public.pilot_requests enable row level security;
-- Intentionally NO policies: only the service role (server) may read/write.
