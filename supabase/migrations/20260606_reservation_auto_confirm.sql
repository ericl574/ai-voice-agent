-- Reservation auto-confirmation (SMS card link) flow.
--
-- Adds the columns the awaiting_customer → confirmed flow needs, plus two SCOPED
-- SECURITY DEFINER functions so the PUBLIC (unauthenticated) /confirm/[token] page can read and
-- confirm exactly one reservation by its secret token WITHOUT weakening row-level security on the
-- appointments table. RLS policies on `appointments` are left untouched; anon never gets table
-- access — only EXECUTE on these two narrow functions.
--
-- Apply via the Supabase SQL editor or `supabase db push`. Additive + idempotent; safe to re-run.

-- 1. Columns --------------------------------------------------------------------------------------
alter table public.appointments
  add column if not exists confirmation_token text,
  add column if not exists expires_at  timestamptz,
  add column if not exists confirmed_at timestamptz;

create index if not exists idx_appointments_confirmation_token
  on public.appointments (confirmation_token)
  where confirmation_token is not null;

-- 2. Read one reservation by token (for the confirm page) -----------------------------------------
create or replace function public.get_reservation_for_confirmation(p_token text)
returns table (
  id uuid,
  customer_name text,
  appointment_date text,
  appointment_time text,
  service_type text,
  status text,
  expires_at timestamptz,
  business_name text
)
language sql
security definer
set search_path = public
as $$
  -- Only columns guaranteed on the generalized appointments table. (party_size is a
  -- restaurant-specific field and is intentionally NOT referenced so this applies on any schema.)
  select a.id,
         a.customer_name,
         a.appointment_date::text,
         a.appointment_time::text,
         a.service_type,
         a.status,
         a.expires_at,
         b.name as business_name
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  where a.confirmation_token = p_token
  limit 1;
$$;

-- 3. Confirm one reservation by token -------------------------------------------------------------
-- Returns one of: 'confirmed' | 'already_confirmed' | 'expired' | 'invalid' | 'not_found'.
-- (The card itself is captured by the payment provider; this only flips the reservation state.)
create or replace function public.confirm_reservation(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.appointments%rowtype;
begin
  select * into rec from public.appointments where confirmation_token = p_token limit 1;
  if not found then
    return 'not_found';
  end if;
  if rec.status = 'confirmed' then
    return 'already_confirmed';
  end if;
  if rec.status <> 'awaiting_customer' then
    return 'invalid';
  end if;
  if rec.expires_at is not null and rec.expires_at < now() then
    update public.appointments set status = 'expired' where id = rec.id;
    return 'expired';
  end if;
  update public.appointments
    set status = 'confirmed', confirmed_at = now()
    where id = rec.id;
  return 'confirmed';
end;
$$;

-- 4. Grants: anon (public confirm page) + authenticated may call ONLY these two functions ---------
grant execute on function public.get_reservation_for_confirmation(text) to anon, authenticated;
grant execute on function public.confirm_reservation(text) to anon, authenticated;
