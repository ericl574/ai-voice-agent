'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_RESERVATIONS, RequestStatus } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

// ─── DB types ──────────────────────────────────────────────────────────────
// Uses flexible optional fields — any schema mismatch surfaces as a visible
// error rather than a silent crash.

interface DbAppointment {
  id: string;
  business_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  party_size?: number | null;
  // Real schema columns
  appointment_date?: string | null;
  appointment_time?: string | null;
  service_type?: string | null;
  special_request?: string | null;
  staff_notes?: string | null;
  // Backwards-compatible fallbacks from initial implementation
  service_details?: string | null;
  requested_date?: string | null;
  requested_time?: string | null;
  notes?: string | null;
  status: string;
  call_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

type Filter = 'all' | RequestStatus;

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Declined', value: 'declined' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function partyOrService(appt: DbAppointment): string {
  if (appt.party_size != null) return `${appt.party_size} guest${appt.party_size !== 1 ? 's' : ''}`;
  if (appt.service_type) return appt.service_type;
  if (appt.service_details) return appt.service_details;
  return '—';
}

function requestedWhen(appt: DbAppointment): { date: string; time: string } {
  const date = appt.appointment_date ?? appt.requested_date ?? '—';
  const time = appt.appointment_time ?? appt.requested_time ?? '';
  return { date, time };
}

function notesText(appt: DbAppointment): string {
  const parts = [appt.special_request, appt.staff_notes, appt.notes].filter(Boolean);
  return parts.join(' · ');
}

// ─── Demo mode ─────────────────────────────────────────────────────────────

function DemoReservationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>(
    () => Object.fromEntries(MOCK_RESERVATIONS.map((r) => [r.id, r.status]))
  );

  const filtered = MOCK_RESERVATIONS.filter(
    (r) => filter === 'all' || statuses[r.id] === filter
  );

  function updateStatus(id: string, status: RequestStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Appointment Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          All requests are initially pending until confirmed by staff.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-5">
        <strong>Staff reminder:</strong> The AI assistant never confirms appointments directly. All requests require your manual confirmation below.
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">
            Demo mode
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Party / Service</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested Date &amp; Time</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r) => {
                const status = statuses[r.id];
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{r.requestedAt}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{r.guestName}</div>
                      <div className="text-xs text-gray-400">{r.phone}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{r.partySize} guests</td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                      {r.requestedDate}
                      <div className="text-xs text-gray-400">{r.requestedTime}</div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs">
                      {r.notes || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateStatus(r.id, 'confirmed')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => updateStatus(r.id, 'declined')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => updateStatus(r.id, 'pending')}
                          className="text-xs font-medium px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                    No reservations match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Real mode ─────────────────────────────────────────────────────────────

function RealReservationsPage({
  appointments: initial,
  loadError,
  businessId,
}: {
  appointments: DbAppointment[];
  loadError: string | null;
  businessId: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  // Local status map for optimistic updates
  const [statuses, setStatuses] = useState<Record<string, string>>(
    () => Object.fromEntries(initial.map((a) => [a.id, a.status]))
  );
  const [updateError, setUpdateError] = useState<string | null>(null);

  const filtered = initial.filter((a) => {
    const s = statuses[a.id] ?? a.status;
    return filter === 'all' || s === filter;
  });

  async function updateStatus(id: string, newStatus: RequestStatus) {
    // Optimistic update
    setStatuses((prev) => ({ ...prev, [id]: newStatus }));
    setUpdateError(null);

    const supabase = createClient();
    const { error } = await supabase
      .from('appointments')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) {
      // Roll back on failure
      setStatuses((prev) => ({ ...prev, [id]: initial.find((a) => a.id === id)?.status ?? prev[id] }));
      setUpdateError(`Failed to update status: ${error.message}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Appointment Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          All requests are initially pending until confirmed by staff.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-5">
        <strong>Staff reminder:</strong> The AI assistant never confirms appointments directly. All requests require your manual confirmation below.
      </div>

      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load appointments:</strong> {loadError}
        </div>
      )}

      {updateError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {updateError}
        </div>
      )}

      {initial.length === 0 && !loadError ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-16 text-center">
          <svg
            className="w-10 h-10 text-gray-300 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-gray-400 text-sm font-medium">No appointment requests yet</p>
          <p className="text-gray-400 text-xs mt-1">
            Appointment requests from AI-handled calls will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f.value
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-sm text-gray-500">
              {initial.length} request{initial.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Party / Service</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested Date &amp; Time</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((a) => {
                  const status = (statuses[a.id] ?? a.status) as RequestStatus;
                  const { date, time } = requestedWhen(a);
                  return (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatCreatedAt(a.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">
                          {a.customer_name ?? <span className="text-gray-400">Unknown</span>}
                        </div>
                        <div className="text-xs text-gray-400">{a.customer_phone ?? ''}</div>
                      </td>
                      <td className="px-5 py-3 text-gray-700 whitespace-nowrap">
                        {partyOrService(a)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                        {date}
                        {time && <div className="text-xs text-gray-400">{time}</div>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-5 py-3 text-gray-500 max-w-xs">
                        {notesText(a) || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {status === 'pending' ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatus(a.id, 'confirmed')}
                              className="text-xs font-medium px-2.5 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => updateStatus(a.id, 'declined')}
                              className="text-xs font-medium px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                            >
                              Decline
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => updateStatus(a.id, 'pending')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                          >
                            Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                      No requests match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export default function ReservationsPage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [appointments, setAppointments] = useState<DbAppointment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string>('');

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function load() {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setMode('demo');
        return;
      }

      const business = await getActiveBusiness(supabase);
      if (!business) {
        setMode('demo');
        return;
      }

      setBusinessId(business.id);

      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });

      if (error) {
        setLoadError(error.message);
      } else {
        setAppointments((data as DbAppointment[]) ?? []);
      }
      setMode('real');
    }

    load();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="p-6 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Appointment Requests</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (mode === 'demo') return <DemoReservationsPage />;

  return (
    <RealReservationsPage
      appointments={appointments}
      loadError={loadError}
      businessId={businessId}
    />
  );
}
