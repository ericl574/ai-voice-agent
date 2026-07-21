// Deterministic reservation-draft validators + readiness gate for the live reservation flow.
//
// This is the DETERMINISTIC half of the reservation tool flow (see docs/call-pipeline.md). The
// Realtime MODEL interprets the caller's audio into structured field values (only the model has the
// audio); this module VALIDATES those values and gates submission. It NEVER re-derives values from
// the lossy transcript, so a garbled transcript can't overwrite a value the model heard correctly.
//
// Self-contained (NO imports) so the standalone Twilio bridge (run via `node --experimental-strip-
// types`) can import it by relative path, the same way it imports turnDetection / endCall / pastTime.
// Pure + total (never throws) so every branch is unit-tested directly.
//
// Scope notes (consistent with the existing sources of truth — no second source is created):
//   • The SUBMIT gate uses the vertical's requiredFields (CollectableField: name/phone/date/time/
//     service), passed in as `required` — the SAME injection pattern assessCollection uses. party_size
//     is a vertical DETAIL, not a core required field, so it is validated-if-present but is only a
//     submit-blocker when the caller explicitly includes it in `required`.
//   • PAST-TIME is NOT decided here (it needs the business clock + timezone). The submit layer runs the
//     shared isPastAppointment() against the draft's date/time — one source of truth for "is it past".

export type ReservationField = 'date' | 'time' | 'party_size' | 'name' | 'phone';
export type FieldStatus = 'empty' | 'valid' | 'needs_clarification';

export interface DraftField<T> {
  value: T | null;
  status: FieldStatus;
}

export interface ReservationDraft {
  date: DraftField<string>;
  time: DraftField<string>;
  party_size: DraftField<number>;
  name: DraftField<string>;
  phone: DraftField<string>;
  // True ONLY after the caller explicitly agrees to a read-back of a ready draft. Any later change to
  // a content field resets it to false (a stale confirmation must never survive a correction).
  caller_confirmed: boolean;
}

// Implausibly large party sizes are a mis-hear, not a real booking. Callers may override per business.
export const MAX_PARTY_SIZE = 40;

// The content fields whose value change invalidates a prior caller confirmation.
const CONTENT_FIELDS: ReservationField[] = ['date', 'time', 'party_size', 'name', 'phone'];

export function emptyDraft(): ReservationDraft {
  return {
    date: { value: null, status: 'empty' },
    time: { value: null, status: 'empty' },
    party_size: { value: null, status: 'empty' },
    name: { value: null, status: 'empty' },
    phone: { value: null, status: 'empty' },
    caller_confirmed: false,
  };
}

// ── Per-field validators (shape/plausibility only — never the clock) ─────────────────────────────
// Each takes the model-reported raw value and returns a normalized DraftField. A provided-but-bad
// value yields status 'needs_clarification' and DOES NOT store a bad value; an absent value is 'empty'.

function absent(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function validateDate(raw: unknown): DraftField<string> {
  if (absent(raw)) return { value: null, status: 'empty' };
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { value: null, status: 'needs_clarification' };
  const [, y, mo, d] = m;
  const yr = Number(y), mon = Number(mo), day = Number(d);
  // Real calendar date (round-trips through Date). Rejects 2026-13-40, 2026-02-30, etc.
  const dt = new Date(Date.UTC(yr, mon - 1, day));
  const ok = dt.getUTCFullYear() === yr && dt.getUTCMonth() === mon - 1 && dt.getUTCDate() === day;
  return ok ? { value: s, status: 'valid' } : { value: null, status: 'needs_clarification' };
}

export function validateTime(raw: unknown): DraftField<string> {
  if (absent(raw)) return { value: null, status: 'empty' };
  const s = String(raw).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { value: null, status: 'needs_clarification' };
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return { value: null, status: 'needs_clarification' };
  const norm = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return { value: norm, status: 'valid' };
}

export function validatePartySize(raw: unknown, max: number = MAX_PARTY_SIZE): DraftField<number> {
  if (absent(raw)) return { value: null, status: 'empty' };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > max) return { value: null, status: 'needs_clarification' };
  return { value: n, status: 'valid' };
}

export function validateName(raw: unknown): DraftField<string> {
  if (absent(raw)) return { value: null, status: 'empty' };
  const s = String(raw).trim();
  // A real name has at least one letter (any script) and a sane length. Rejects "", "...", "1234".
  if (s.length < 1 || s.length > 100 || !/\p{L}/u.test(s)) {
    return { value: null, status: 'needs_clarification' };
  }
  return { value: s, status: 'valid' };
}

export function validatePhone(raw: unknown): DraftField<string> {
  if (absent(raw)) return { value: null, status: 'empty' };
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  // Optional everywhere; only flags an implausible number. 7+ digits ≈ a real phone number.
  if (digits.length < 7 || digits.length > 15) return { value: null, status: 'needs_clarification' };
  return { value: s, status: 'valid' };
}

function validateField(field: ReservationField, raw: unknown, maxParty: number): DraftField<string | number> {
  switch (field) {
    case 'date': return validateDate(raw);
    case 'time': return validateTime(raw);
    case 'party_size': return validatePartySize(raw, maxParty);
    case 'name': return validateName(raw);
    case 'phone': return validatePhone(raw);
  }
}

// ── Draft mutation ───────────────────────────────────────────────────────────────────────────────

export type DraftUpdate = Partial<{
  date: unknown;
  time: unknown;
  party_size: unknown;
  name: unknown;
  phone: unknown;
}>;

// Apply model-reported field values to the draft. Each provided field is validated; a provided-but-bad
// value becomes 'needs_clarification' (never stored). CRITICAL: if any content field's VALUE changes,
// caller_confirmed resets to false so a stale confirmation can't survive a correction. Returns a new
// draft (pure — the input is not mutated).
export function applyDraftUpdate(
  draft: ReservationDraft,
  update: DraftUpdate,
  maxParty: number = MAX_PARTY_SIZE,
): ReservationDraft {
  const next: ReservationDraft = {
    date: { ...draft.date },
    time: { ...draft.time },
    party_size: { ...draft.party_size },
    name: { ...draft.name },
    phone: { ...draft.phone },
    caller_confirmed: draft.caller_confirmed,
  };
  let valueChanged = false;
  for (const field of CONTENT_FIELDS) {
    if (!(field in update)) continue;
    const before = next[field].value;
    const validated = validateField(field, (update as Record<string, unknown>)[field], maxParty);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any)[field] = validated;
    if (validated.value !== before) valueChanged = true;
  }
  if (valueChanged) next.caller_confirmed = false;
  return next;
}

// ── Readiness + submission gates ───────────────────────────────────────────────────────────────

// The required set is INJECTED (map the vertical's requiredFields to reservation fields at the call
// site — same pattern as assessCollection). A field is satisfied only when its status is 'valid'.
export function stillNeeded(draft: ReservationDraft, required: readonly ReservationField[]): ReservationField[] {
  const seen = new Set<ReservationField>();
  const out: ReservationField[] = [];
  for (const f of required) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (draft[f].status !== 'valid') out.push(f);
  }
  return out;
}

// Every field the caller HAS answered but that came back unclear — the model must re-ask these,
// regardless of whether they are required (this is what stops an unclear party size from being
// silently accepted and skipped past).
export function needsClarification(draft: ReservationDraft): ReservationField[] {
  return CONTENT_FIELDS.filter((f) => draft[f].status === 'needs_clarification');
}

export function isReadyToHold(draft: ReservationDraft, required: readonly ReservationField[]): boolean {
  return stillNeeded(draft, required).length === 0;
}

// Record the caller's explicit agreement after a read-back. Only accepted when the draft is ready
// (per the agreed contract: caller_confirmed=true is valid only when nothing is still needed), so a
// confirmation can never be recorded for an incomplete draft. Pure.
export function setCallerConfirmed(draft: ReservationDraft, required: readonly ReservationField[]): ReservationDraft {
  if (!isReadyToHold(draft, required)) return draft;
  return { ...draft, caller_confirmed: true };
}

// The deterministic precondition for submit_reservation_request: ready AND explicitly confirmed.
export function canSubmit(draft: ReservationDraft, required: readonly ReservationField[]): boolean {
  return draft.caller_confirmed === true && isReadyToHold(draft, required);
}

// The reservation-draft fields (draft slots), used to map the vertical's core required fields.
const RESERVATION_FIELDS: readonly ReservationField[] = ['date', 'time', 'party_size', 'name', 'phone'];

// The CANONICAL runtime required-field set for a reservation. This is the SINGLE source both the
// browser and the Twilio bridge use (the app computes it once from the resolved vertical and sends it
// to each transport in the session payload — see voice-session / twilio/session-config), so the two
// paths can never drift.
//
//   • Maps the vertical's core requiredFields (CollectableField: name/phone/date/time/service) to the
//     reservation-draft slots. 'service' has no reservation slot, so it is not gated here (it stays a
//     post-call completeness concern via assessCollection).
//   • party_size is REQUIRED for RESTAURANT reservations ONLY — a table booking is meaningless without
//     it. Salon / clinic / auto_repair / tutoring / home_services / other never require party_size.
//
// Pure + zero-import so the standalone bridge can compute/consume it identically.
export function requiredReservationFields(
  businessType: string | null | undefined,
  coreRequired: readonly string[],
): ReservationField[] {
  const out: ReservationField[] = [];
  const add = (f: ReservationField) => { if (!out.includes(f)) out.push(f); };
  for (const f of coreRequired) {
    if ((RESERVATION_FIELDS as readonly string[]).includes(f)) add(f as ReservationField);
  }
  if (businessType === 'restaurant') add('party_size');
  return out;
}

// Rebuild a draft server-side from the model-reported VALUES a client submitted, RE-validating each
// (the client's own field statuses are ignored — the server is authoritative). Used by both submit
// routes so a buggy/hostile client can't force a submit with unvalidated values. Pure.
export function draftFromClient(raw: unknown, required: readonly ReservationField[]): ReservationDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const field = (f: ReservationField) => (r[f] as { value?: unknown } | undefined)?.value;
  let d = applyDraftUpdate(emptyDraft(), {
    date: field('date'),
    time: field('time'),
    party_size: field('party_size'),
    name: field('name'),
    phone: field('phone'),
  });
  if (r.caller_confirmed === true) d = setCallerConfirmed(d, required);
  return d;
}
