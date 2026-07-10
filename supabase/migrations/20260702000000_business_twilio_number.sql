-- Multi-business Twilio routing — map each FrontDesk inbound (Twilio) number to a business.
-- Additive only; no existing data or policies are modified. Run before onboarding a 2nd pilot line.
--
-- The Twilio webhook (/api/twilio/voice) resolves WHICH business a call is for from the dialed
-- number (params.To) via this column, instead of a single env-pinned TWILIO_BUSINESS_ID. Store the
-- FrontDesk-owned Twilio number the business's calls forward TO (E.164 preferred, e.g. +16045550100);
-- the matcher is NANP-aware so common formats still match. This is NOT the business's own public
-- phone (that stays businesses.phone).

alter table public.businesses
  add column if not exists twilio_number text; -- FrontDesk inbound (Twilio) number for this business

-- One Twilio number answers for exactly one business. Partial unique index ignores NULLs so
-- businesses without a mapped line are unaffected.
create unique index if not exists businesses_twilio_number_key
  on public.businesses (twilio_number)
  where twilio_number is not null;
