-- Live reservation submission: idempotency + recovery marking on appointments.
--
-- Supports the reservation-draft tool flow (docs/call-pipeline.md): the live submit persists ONE
-- reservation per call, and post-call extraction enriches that same row instead of creating a second.
--
--   request_ref          — canonical per-call idempotency key: CallSid (Twilio) / session-call UUID
--                          (browser). At most one reservation per call via the partial unique index
--                          below. Live submit writes it with call_id NULL; post-call backfills call_id.
--   origin               — 'caller_submitted' (live, caller-confirmed) | 'post_call_recovered'
--                          (reconstructed after a hang-up; NOT customer-submitted).
--   call_id              — relaxed to NULLABLE so a live submit can persist before the calls row
--                          exists (the phone calls row is created post-call); backfilled at post-call.
--   status 'incomplete'  — a post_call_recovered reservation the caller never confirmed/submitted;
--                          status is text (no enum), so no type change is needed. It must NOT read as
--                          pending / awaiting_customer / awaiting_staff_confirmation / confirmed, and
--                          it carries needs_staff_followup.
--
-- Additive + idempotent; safe to re-run. service_requests are intentionally NOT touched in this pass.
-- Apply via the Supabase SQL editor or `supabase db push`.

alter table public.appointments
  add column if not exists request_ref text,
  add column if not exists origin      text;

-- At most one reservation per (business, request_ref). Partial so existing rows (request_ref NULL)
-- never collide and are exempt.
create unique index if not exists idx_appointments_request_ref
  on public.appointments (business_id, request_ref)
  where request_ref is not null;

-- Allow a live submit to persist before the calls row exists (backfilled at post-call). DROP NOT NULL
-- is a no-op if the column is already nullable, so this is safe regardless of the current constraint.
alter table public.appointments
  alter column call_id drop not null;
