// Shared appointment types + helpers used by the Appointment Requests list (reservations) and the
// Schedule view. Kept framework-agnostic (pure functions) so both pages share one source of truth.

import type { Reservation } from '@/lib/mock-data';

// ─── DB type ─────────────────────────────────────────────────────────────────

export interface DbAppointment {
  id: string;
  business_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  party_size?: number | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  service_type?: string | null;
  special_request?: string | null;
  staff_notes?: string | null;
  service_details?: string | null;
  requested_date?: string | null;
  requested_time?: string | null;
  notes?: string | null;
  status: string;
  call_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function partyOrService(appt: DbAppointment): string {
  if (appt.party_size != null) return `${appt.party_size} guest${appt.party_size !== 1 ? 's' : ''}`;
  if (appt.service_type) return appt.service_type;
  if (appt.service_details) return appt.service_details;
  return 'Appointment';
}

export function requestedWhen(appt: DbAppointment): { date: string; time: string } {
  const date = appt.appointment_date ?? appt.requested_date ?? '';
  const time = appt.appointment_time ?? appt.requested_time ?? '';
  return { date, time };
}

export function notesText(appt: DbAppointment): string {
  const parts = [appt.special_request, appt.staff_notes, appt.notes].filter(Boolean);
  return parts.join(' · ');
}

export function customerInitial(name: string | null | undefined): string {
  if (!name) return '·';
  return name.trim()[0]?.toUpperCase() ?? '·';
}

// Apple Contacts-style soft tinted avatars — deterministic by name hash. Shared across the
// queue pages (calls / orders / reservations / schedule) so the avatar vocabulary is identical.
export const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#E8F0FE', fg: '#1E40AF' }, // blue
  { bg: '#E6F4EA', fg: '#166534' }, // green
  { bg: '#FCE7E6', fg: '#9F1239' }, // rose
  { bg: '#FEF3C7', fg: '#92400E' }, // amber
  { bg: '#EDE9FE', fg: '#5B21B6' }, // violet
  { bg: '#E0F2FE', fg: '#075985' }, // sky
  { bg: '#FCE7F3', fg: '#9D174D' }, // pink
  { bg: '#D1FAE5', fg: '#065F46' }, // emerald
];

export function avatarFor(name: string | null | undefined): { bg: string; fg: string } {
  const safe = (name ?? '').trim();
  let hash = 0;
  for (let i = 0; i < safe.length; i++) hash = (hash * 31 + safe.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// ─── Schedule / calendar helpers ─────────────────────────────────────────────

// Parse an appointment's date + time into a Date, or null if either is missing/unparseable.
// Handles real rows ('YYYY-MM-DD' + 'HH:MM') and demo rows ('May 17, 2026' + '7:30 PM').
export function parseApptDateTime(appt: DbAppointment): Date | null {
  const { date, time } = requestedWhen(appt);
  if (!date || !time) return null;
  // ISO combine first (real format), then space combine (demo / locale strings).
  const iso = new Date(`${date}T${time}`);
  if (!Number.isNaN(iso.getTime())) return iso;
  const loose = new Date(`${date} ${time}`);
  if (!Number.isNaN(loose.getTime())) return loose;
  return null;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Monday-anchored start of the week containing `date` (local time, midnight).
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - diff);
  return d;
}

// The 7 day-dates (Mon..Sun) for the week containing `date`.
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Maps demo reservations into the DbAppointment shape so the schedule + list render through one
// path in both demo and real mode. (party_size carries the restaurant "guests" label.)
export function mockToAppointments(reservations: Reservation[]): DbAppointment[] {
  return reservations.map((r) => ({
    id: r.id,
    business_id: 'demo',
    customer_name: r.guestName,
    customer_phone: r.phone,
    party_size: r.partySize,
    appointment_date: r.requestedDate,
    appointment_time: r.requestedTime,
    service_type: null,
    special_request: r.notes,
    status: r.status,
    call_id: r.callId,
    created_at: r.requestedAt,
  }));
}
