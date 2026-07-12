# Supabase RLS Verification — the one hard gate before a real pilot

> ✅ **VERIFIED 2026-07-12.** A live-DB audit confirmed all 11 business-data tables have RLS enabled with
> correct `business_id`/`user_id`-scoped policies (reads + writes) — **no cross-tenant leak** — and the
> migration history was reconciled (all 7 repo migrations now match production). This doc is retained as
> the re-verification runbook. Remaining (optional, DR only): capture a core-schema baseline via `supabase db pull`.

**Why this exists (audit finding C1):** the base tables (`businesses`, `calls`, `call_messages`,
`appointments`, `service_requests`, `customers`, `business_knowledge`, `business_members`,
`profiles`) were created **directly in Supabase and are NOT in `supabase/migrations/`.** So their
**Row-Level Security (RLS) policies cannot be reviewed from the repo.** Tenant isolation — the
guarantee that one business can never read another's calls/customers — depends entirely on those
policies. **This must be confirmed by Eric in the Supabase dashboard before a second business exists.**

This doc is **read-only verification + reference**. It performs no destructive action. Nothing here
is run automatically — Eric runs the SELECTs, reviews, and only then (carefully) applies any missing
policy.

---

## Step 1 — Verify (read-only, safe to run anytime)

Supabase → SQL Editor. This only reads catalog metadata:

```sql
-- (a) Which public tables exist, and is RLS enabled on each?
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- (b) What policies exist, per table?
select tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

**Expected result (the pass condition):** every table that holds business data —
`businesses`, `calls`, `call_messages`, `appointments`, `service_requests`, `customers`,
`business_knowledge`, `business_members`, `call_digests`, `pilot_requests` — has
`rls_enabled = true` **and** at least a `SELECT` policy that scopes rows to the signed-in user's
business (via `business_members`). `call_digests`, `pilot_requests`, and `billing_subscriptions`
ship with RLS in their migrations already (verify they show up).

If any business-data table shows `rls_enabled = false` **or** has no `business_id`-scoped policy →
**that is a cross-tenant leak risk. Do not onboard a second business until it is fixed.**

---

## Step 2 — Reference policy shape (apply ONLY where Step 1 shows a gap)

The intended pattern (already used by `call_digests` in its migration): members of a business may
read that business's rows; **only the server (service role) writes** the call/appointment tables.

```sql
-- Example for `calls`. Repeat per business-data table, adjusting the table name.
alter table public.calls enable row level security;

create policy "members read own business calls"
  on public.calls for select
  using (
    business_id in (
      select business_id from public.business_members where user_id = auth.uid()
    )
  );
```

`businesses` itself scopes differently (a member can read their own business):

```sql
alter table public.businesses enable row level security;
create policy "members read own business"
  on public.businesses for select
  using (
    id in (select business_id from public.business_members where user_id = auth.uid())
  );
```

> ⚠️ **Careful — order matters.** Enabling RLS on a table that has **no** policy denies **all**
> access, including the app's own authenticated reads. Always `enable row level security` **and**
> create the `select` policy **together**, and **test on a staging copy or a throwaway project
> first**. This is why this step is Eric's to run, not automated.

---

## Step 2b — Verified for THIS app: tables the USER client WRITES (the foot-gun)

⚠️ **Read this before enabling RLS.** Several tables are written by the **signed-in user's browser
client**, not just the service role. If you enable RLS on them with a **SELECT-only** policy, these
core flows silently BREAK (verified in code this run):

- **Browser test-call save** → `calls` + `call_messages` INSERT (`voice/page.tsx:1409/1418/1453`).
- **Appointment confirm/decline + manual add** → `appointments` UPDATE/INSERT (`reservations/page.tsx:128/184`).
- **Knowledge base editing** → `business_knowledge` INSERT/UPDATE/DELETE (`knowledge/page.tsx:760/795/733`).
- **Settings save** → `businesses` UPDATE of `agent_config` (`reservations/page.tsx:154`, `knowledge/page.tsx:1011`).

Phone-call saves go through the **service role**, which **bypasses RLS** — those need no write policy.

**Verified column facts (from code):** `calls`, `appointments`, `service_requests`, `business_knowledge`
have `business_id`; `call_messages` has **no** `business_id` (scope via `call_id` → `calls`);
`business_members` scopes by `user_id`; `businesses` by `id`. (`customers`: confirm its columns before
adding — not verified here.)

So each user-written table needs a policy covering **both read and write**, scoped to the caller's
business. Use `for all` with `using` (read) + `with check` (write):

```sql
-- calls (repeat this shape for appointments, service_requests, business_knowledge — all have business_id)
alter table public.calls enable row level security;
create policy "members access own business calls" on public.calls
  for all
  using      (business_id in (select business_id from public.business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from public.business_members where user_id = auth.uid()));

-- call_messages has NO business_id — join through calls:
alter table public.call_messages enable row level security;
create policy "members access own business call_messages" on public.call_messages
  for all
  using      (call_id in (select id from public.calls where business_id in
              (select business_id from public.business_members where user_id = auth.uid())))
  with check (call_id in (select id from public.calls where business_id in
              (select business_id from public.business_members where user_id = auth.uid())));
```

**After enabling RLS, test every dashboard write on a staging copy** (save a test call, confirm an
appointment, add/edit a KB entry, save settings). A missing write policy breaks that flow with no error
in the UI.

> **App-layer note (verified this run):** the dashboard already filters every read by `business_id` in
> code — `getActiveBusiness()` (now `user_id`-scoped) → `.eq('business_id', …)` on each page query
> (`dashboard/page.tsx:660-684`). So **accidental** cross-tenant reads are already prevented for normal
> app use. RLS is what additionally blocks a **direct** anon-key API request for another business's
> rows — which app-layer filters cannot. Both layers matter.

## Step 3 — Make it reproducible (recommended, not a pilot blocker)

So this is never unverifiable again:

1. Supabase → Database → **Schema** (or `pg_dump --schema-only`) → export the current schema **and**
   policies.
2. Commit it as `supabase/migrations/00000000000000_baseline_schema.sql` (a baseline).
3. From then on the repo is the source of truth and a fresh/staging environment is reproducible.

Do **not** run a baseline dump against, or restore into, the live pilot database — export only.

---

## Quick checklist

- [ ] Ran Step-1 queries; captured the table/policy list.
- [ ] Every business-data table has `rls_enabled = true`.
- [ ] Every business-data table has a `business_id`-scoped `SELECT` policy.
- [ ] Write access to `calls`/`appointments`/etc. is service-role only (no broad `INSERT`/`UPDATE` policy for `authenticated`).
- [ ] (Recommended) Exported + committed a baseline schema migration.
