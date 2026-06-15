-- Optional, additive: mark where a call came from so the dashboard can distinguish real phone
-- calls from browser test calls. Existing rows stay null (treated as 'web'). The Twilio save
-- path works without this column (it retries the insert without `source`), but run it before
-- the phone pilot so phone calls are identifiable.

alter table public.calls
  add column if not exists source text; -- 'web' | 'phone' (null = legacy/web)
