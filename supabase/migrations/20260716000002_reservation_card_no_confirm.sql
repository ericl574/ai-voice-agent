-- Card completion is NOT a confirmed booking.
--
-- Completing the SMS card link proves the CUSTOMER's intent and payment method, but WITHOUT an
-- availability/capacity source it does NOT prove the requested slot is actually available. So card
-- completion must land on 'awaiting_staff_confirmation' (customer verified; staff must still confirm),
-- never 'confirmed'. 'confirmed' is reachable ONLY by explicit staff acceptance (dashboard) or a
-- future availability system that truly reserves the slot.
--
-- Additive + idempotent; safe to re-run. Redefines confirm_reservation() from
-- 20260606_reservation_auto_confirm.sql and records the customer-verification timestamp separately
-- from confirmed_at (which is now reserved for a real staff/system confirmation).

alter table public.appointments
  add column if not exists customer_verified_at timestamptz;

-- Confirm-by-token: the customer verifies via the card link → 'awaiting_staff_confirmation'.
-- Returns one of: 'verified' | 'already_verified' | 'expired' | 'invalid' | 'not_found'.
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
  -- Idempotent re-click: the customer already verified, or staff already confirmed → done, no change.
  if rec.status in ('awaiting_staff_confirmation', 'confirmed') then
    return 'already_verified';
  end if;
  -- Only an awaiting_customer reservation can be verified via the card link.
  if rec.status <> 'awaiting_customer' then
    return 'invalid';
  end if;
  if rec.expires_at is not null and rec.expires_at < now() then
    update public.appointments set status = 'expired' where id = rec.id;
    return 'expired';
  end if;
  -- Customer verified their details/payment method. Staff must still confirm availability — this is
  -- NOT a confirmed booking, so we do NOT set status='confirmed' or confirmed_at here.
  update public.appointments
    set status = 'awaiting_staff_confirmation', customer_verified_at = now()
    where id = rec.id;
  return 'verified';
end;
$$;

-- Grants unchanged (create-or-replace preserves them; re-granting is idempotent + explicit).
grant execute on function public.confirm_reservation(text) to anon, authenticated;
