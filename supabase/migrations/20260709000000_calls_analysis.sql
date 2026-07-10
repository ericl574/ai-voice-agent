-- Post-call Analyst output — structured, staff-facing analysis per call, kept SEPARATE from the
-- verbatim transcript (which stays in calls.transcript). Additive only; nothing existing is modified.
-- The save path writes this best-effort (works fine before this migration runs — the column just
-- stays null until then).
--
-- Shape (jsonb): { caller_name, caller_phone, intent, requested_service, requested_time,
--                  booking_status, staff_action_required, confidence, risk_flags[], staff_summary }

alter table public.calls
  add column if not exists analysis jsonb;
