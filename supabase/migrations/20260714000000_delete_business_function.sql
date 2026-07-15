-- Atomic deletion of one business and ALL its business-owned data. Called by the in-app
-- "Delete account & all data" flow (/api/account/delete) via the service role, AFTER the route has
-- authorized the caller as the business owner and validated the typed confirmations.
--
-- Why a function: a plpgsql function runs inside a single transaction, so a mid-delete failure rolls
-- back EVERYTHING — there is no half-deleted business. (The previous client-side "delete table 1,
-- then table 2, …" strategy could leave partial data on an error mid-sequence.)
--
-- Scope: deletes children before the parent `businesses` row. Some of these tables also have
-- ON DELETE CASCADE from businesses (billing_subscriptions, call_digests), so the explicit deletes
-- are belt-and-suspenders and always safe. Intentionally EXCLUDED:
--   * profiles       — user-scoped, not business-owned (the route removes the auth user separately,
--                      and only when it was the user's final business membership)
--   * pilot_requests — a GLOBAL lead store (/contact leads), not owned by any single business
-- Additive only: creates a function; modifies no existing table or policy.

create or replace function public.delete_business_data(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- call_messages has no business_id — scope it via the business's calls, BEFORE deleting calls.
  delete from call_messages where call_id in (select id from calls where business_id = p_business_id);
  delete from calls                 where business_id = p_business_id;
  delete from appointments          where business_id = p_business_id;
  delete from service_requests      where business_id = p_business_id;
  delete from business_knowledge    where business_id = p_business_id;
  delete from customers             where business_id = p_business_id;
  delete from call_digests          where business_id = p_business_id;
  delete from billing_subscriptions where business_id = p_business_id;
  delete from business_members      where business_id = p_business_id;
  delete from businesses            where id = p_business_id; -- parent, last
end;
$$;

-- Only the server (service role) may execute this; the route authorizes the owner first. No end user
-- (anon/authenticated) can invoke it directly, even with a valid session.
revoke all on function public.delete_business_data(uuid) from public;
revoke all on function public.delete_business_data(uuid) from anon;
revoke all on function public.delete_business_data(uuid) from authenticated;
grant execute on function public.delete_business_data(uuid) to service_role;
