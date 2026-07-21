// Canonical reservation persistence — shared by the browser and Twilio submit routes (auth differs
// only at the transport boundary; both call persistReservationRequest with an already-authorized
// supabase client + a server-resolved business_id). Runs in the Next app only (NOT the bridge — the
// bridge POSTs to a route), so it may use richer imports than reservationDraft.ts.
//
// Guarantees (see docs/call-pipeline.md):
//   • ONE reservation per call — upsert keyed by (business_id, request_ref); retries/reconnects/dup
//     tool events converge on the same row.
//   • Truthful status — 'awaiting_customer' (auto mode + phone: card link) or 'pending' (staff-confirm).
//     NEVER 'confirmed' (no availability source). origin = 'caller_submitted' (a live, confirmed submit).
//   • Draft values are the record of truth — post-call enrichment fills only NULLs and never overwrites
//     these (see buildReservationEnrichment).

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { ReservationDraft } from './reservationDraft';

export type ReservationMode = 'staff' | 'auto';
export type LiveReservationStatus = 'pending' | 'awaiting_customer';

export interface ReservationRow {
  business_id: string;
  request_ref: string;
  call_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  party_size: number | null;
  service_type: string;
  status: LiveReservationStatus;
  origin: 'caller_submitted';
  staff_notes: string;
  confirmation_token?: string;
  expires_at?: string;
}

// Auto (card link) mode only applies when we actually have a phone to text. Same rule postCallCore
// uses, so the live path and the post-call path can't disagree on the status.
export function reservationStatusFor(mode: ReservationMode, hasPhone: boolean): LiveReservationStatus {
  return mode === 'auto' && hasPhone ? 'awaiting_customer' : 'pending';
}

// Pure: derive the appointment row from a validated, caller-confirmed draft. The caller MUST already
// have passed canSubmit() upstream — this only shapes the row (no validation, no availability claim).
export function buildReservationRow(args: {
  businessId: string;
  requestRef: string;
  callId: string | null;
  draft: ReservationDraft;
  mode: ReservationMode;
  windowHours?: number;
  now?: number;
  token?: string; // injectable for deterministic tests
}): ReservationRow {
  const { businessId, requestRef, callId, draft, mode } = args;
  const phone = draft.phone.value ?? null;
  const status = reservationStatusFor(mode, !!phone);
  const auto = status === 'awaiting_customer';
  const windowHours = args.windowHours ?? 24;
  const now = args.now ?? Date.now();

  const row: ReservationRow = {
    business_id: businessId,
    request_ref: requestRef,
    call_id: callId,
    customer_name: draft.name.value ?? null,
    customer_phone: phone,
    appointment_date: draft.date.value ?? null,
    appointment_time: draft.time.value ?? null,
    party_size: draft.party_size.value ?? null,
    service_type: 'Reservation request',
    status,
    origin: 'caller_submitted',
    staff_notes: auto
      ? 'Submitted by caller on the call. Awaiting customer card verification; staff still confirm.'
      : 'Submitted by caller on the call. Staff to confirm.',
  };
  if (auto) {
    row.confirmation_token = args.token ?? randomUUID();
    row.expires_at = new Date(now + windowHours * 3600_000).toISOString();
  }
  return row;
}

// Pure: compute the UPDATE that ENRICHES an existing live-submitted row from post-call extraction —
// WITHOUT overwriting caller-confirmed tool values. Precedence: tool values > post-call > transcript.
//   • Core fields (name/phone/date/time/party_size/service) are filled ONLY when NULL on the row.
//   • Metadata the tool never sets (staff_notes append) is always allowed.
//   • call_id is backfilled when the row still has none.
//   • status is NEVER changed (the tool set the correct pending/awaiting_customer).
export function buildReservationEnrichment(
  existing: Record<string, unknown>,
  extraction: {
    caller_name?: string | null;
    caller_phone?: string | null;
    appointment?: { requested_date?: string | null; requested_time?: string | null; service?: string | null } | null;
    next_action?: string;
  },
  callId: string | null,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  const isNull = (k: string) => existing[k] === null || existing[k] === undefined || existing[k] === '';

  if (isNull('call_id') && callId) update.call_id = callId;
  if (isNull('customer_name') && extraction.caller_name) update.customer_name = extraction.caller_name;
  if (isNull('customer_phone') && extraction.caller_phone) update.customer_phone = extraction.caller_phone;
  if (isNull('appointment_date') && extraction.appointment?.requested_date) update.appointment_date = extraction.appointment.requested_date;
  if (isNull('appointment_time') && extraction.appointment?.requested_time) update.appointment_time = extraction.appointment.requested_time;
  if (isNull('service_type') && extraction.appointment?.service) update.service_type = extraction.appointment.service;

  // Metadata the tool never owns — safe to append the analyst's suggested follow-up.
  if (extraction.next_action && extraction.next_action.trim()) {
    const prior = typeof existing.staff_notes === 'string' ? existing.staff_notes : '';
    update.staff_notes = `${prior} ${extraction.next_action}`.trim();
  }
  // status, origin, party_size, and any non-null tool value are intentionally NOT in `update`.
  return update;
}

// Durable upsert keyed by (business_id, request_ref). Idempotent: a second submit (retry/reconnect/
// dup tool event) updates the SAME row and returns persisted:true again — never a duplicate. Returns
// persisted:false on a DB error so the assistant does NOT claim submission.
export async function persistReservationRequest(
  supabase: SupabaseClient,
  args: {
    businessId: string;
    requestRef: string;
    callId: string | null;
    draft: ReservationDraft;
    mode: ReservationMode;
    windowHours?: number;
  },
): Promise<{ persisted: boolean; recordId: string | null; status: LiveReservationStatus; error?: string }> {
  const row = buildReservationRow(args);
  const { data, error } = await supabase
    .from('appointments')
    .upsert(row, { onConflict: 'business_id,request_ref' })
    .select('id, status')
    .single();
  if (error || !data) {
    return { persisted: false, recordId: null, status: row.status, error: error?.message ?? 'no row returned' };
  }
  return { persisted: true, recordId: data.id as string, status: (data.status as LiveReservationStatus) ?? row.status };
}
