'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_CALLS, MOCK_RESERVATIONS, MOCK_ORDERS } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

// ─── DB types (minimal — only fields used in this page) ────────────────────

interface DbCall {
  id: string;
  customer_name?: string | null;
  caller_name?: string | null;
  customer_phone?: string | null;
  caller_phone?: string | null;
  intent?: string | null;
  call_type?: string | null;
  status?: string | null;
  summary?: string | null;
  started_at?: string | null;
  created_at: string;
}

interface DbAppointment {
  id: string;
  customer_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  party_size?: number | null;
  service_type?: string | null;
  status: string;
  created_at: string;
}

interface DbServiceRequest {
  id: string;
  customer_name?: string | null;
  request_type?: string | null;
  request_details?: string | null;
  status: string;
  created_at: string;
}

interface RealStats {
  callCount: number;
  pendingAppointmentCount: number;
  pendingRequestCount: number;
  knowledgeCount: number;
  recentCalls: DbCall[];
  pendingAppointments: DbAppointment[];
  pendingRequests: DbServiceRequest[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Demo mode ─────────────────────────────────────────────────────────────

const TODAY = '2026-05-15';
const todaysCalls = MOCK_CALLS.filter((c) => c.date === TODAY);
const pendingReservations = MOCK_RESERVATIONS.filter((r) => r.status === 'pending');
const pendingOrders = MOCK_ORDERS.filter((o) => o.status === 'pending');
const resolvedToday = todaysCalls.filter((c) => c.status === 'resolved');

const DEMO_STATS = [
  { label: 'Calls Today', value: todaysCalls.length, color: 'text-blue-600', bg: 'bg-blue-50' },
  { label: 'Pending Reservations', value: pendingReservations.length, color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Pending Orders', value: pendingOrders.length, color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Resolved Today', value: resolvedToday.length, color: 'text-green-600', bg: 'bg-green-50' },
];

const MOCK_TYPE_LABEL: Record<string, string> = {
  reservation: 'Reservation',
  order: 'Order',
  inquiry: 'Inquiry',
  complaint: 'Complaint',
};

function DemoDashboardPage() {
  const recentCalls = MOCK_CALLS.slice(0, 5);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Thursday, May 15, 2026</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {DEMO_STATS.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className={`text-3xl font-bold ${s.color} mb-1`}>{s.value}</div>
            <div className="text-xs text-gray-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Calls</h2>
          <Link href="/dashboard/calls" className="text-xs text-orange-600 hover:underline font-medium">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recentCalls.map((call) => (
            <div key={call.id} className="px-5 py-3 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">{call.callerName}</span>
                  <span className="text-xs text-gray-400">{call.callerPhone}</span>
                  <span className="text-xs text-gray-400">{call.time}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{call.summary}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <StatusBadge status={call.status} />
                <span className="text-xs text-gray-400">{MOCK_TYPE_LABEL[call.type]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Reservations</h2>
            <Link href="/dashboard/reservations" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingReservations.length === 0 ? (
            <p className="text-sm text-gray-400">No pending reservations.</p>
          ) : (
            <ul className="space-y-2">
              {pendingReservations.map((r) => (
                <li key={r.id} className="text-sm text-gray-700">
                  <span className="font-medium">{r.guestName}</span>
                  {' — '}party of {r.partySize},{' '}
                  <span className="text-gray-500">
                    {r.requestedDate} at {r.requestedTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Orders</h2>
            <Link href="/dashboard/orders" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingOrders.length === 0 ? (
            <p className="text-sm text-gray-400">No pending orders.</p>
          ) : (
            <ul className="space-y-2">
              {pendingOrders.map((o) => (
                <li key={o.id} className="text-sm text-gray-700">
                  <span className="font-medium">{o.customerName}</span>
                  {' — '}
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Real mode ─────────────────────────────────────────────────────────────

function RealDashboardPage({
  stats,
  loadError,
}: {
  stats: RealStats;
  loadError: string | null;
}) {
  const {
    callCount,
    pendingAppointmentCount,
    pendingRequestCount,
    knowledgeCount,
    recentCalls,
    pendingAppointments,
    pendingRequests,
  } = stats;

  const REAL_STATS = [
    { label: 'Total Calls', value: callCount, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Pending Appointments', value: pendingAppointmentCount, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Pending Requests', value: pendingRequestCount, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Knowledge Entries', value: knowledgeCount, color: 'text-green-600', bg: 'bg-green-50' },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">{todayLabel()}</p>
      </div>

      {loadError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load dashboard data:</strong> {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {REAL_STATS.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className={`text-3xl font-bold ${s.color} mb-1`}>{s.value}</div>
            <div className="text-xs text-gray-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Recent Calls */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Calls</h2>
          <Link href="/dashboard/calls" className="text-xs text-orange-600 hover:underline font-medium">
            View all →
          </Link>
        </div>
        {recentCalls.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No calls yet. Calls handled by the AI assistant will appear here.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentCalls.map((call) => {
              const name = call.customer_name ?? call.caller_name ?? 'Unknown';
              const phone = call.customer_phone ?? call.caller_phone ?? '';
              const type = call.intent ?? call.call_type ?? '';
              const when = formatDateTime(call.started_at ?? call.created_at);
              return (
                <div key={call.id} className="px-5 py-3 flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-900">{name}</span>
                      {phone && <span className="text-xs text-gray-400">{phone}</span>}
                      <span className="text-xs text-gray-400">{when}</span>
                    </div>
                    {call.summary && (
                      <p className="text-xs text-gray-500 truncate">{call.summary}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {call.status && <StatusBadge status={call.status as 'resolved' | 'escalated' | 'missed'} />}
                    {type && <span className="text-xs text-gray-400">{cap(type)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending mini-lists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Appointments</h2>
            <Link href="/dashboard/reservations" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingAppointments.length === 0 ? (
            <p className="text-sm text-gray-400">No pending appointments.</p>
          ) : (
            <ul className="space-y-2">
              {pendingAppointments.map((a) => (
                <li key={a.id} className="text-sm text-gray-700">
                  <span className="font-medium">{a.customer_name ?? 'Unknown'}</span>
                  {(a.appointment_date || a.appointment_time) && (
                    <span className="text-gray-500">
                      {' — '}
                      {[a.appointment_date, a.appointment_time].filter(Boolean).join(' at ')}
                    </span>
                  )}
                  {a.party_size != null && (
                    <span className="text-gray-400 text-xs"> · party of {a.party_size}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Requests</h2>
            <Link href="/dashboard/orders" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingRequests.length === 0 ? (
            <p className="text-sm text-gray-400">No pending requests.</p>
          ) : (
            <ul className="space-y-2">
              {pendingRequests.map((r) => (
                <li key={r.id} className="text-sm text-gray-700">
                  <span className="font-medium">{r.customer_name ?? 'Unknown'}</span>
                  {r.request_type && (
                    <span className="text-gray-500"> — {r.request_type}</span>
                  )}
                  {r.request_details && (
                    <span className="text-gray-400 text-xs block truncate">{r.request_details}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

const EMPTY_STATS: RealStats = {
  callCount: 0,
  pendingAppointmentCount: 0,
  pendingRequestCount: 0,
  knowledgeCount: 0,
  recentCalls: [],
  pendingAppointments: [],
  pendingRequests: [],
};

export default function DashboardPage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [stats, setStats] = useState<RealStats>(EMPTY_STATS);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function load() {
      const supabase = createClient();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMode('demo');
        return;
      }

      const business = await getActiveBusiness(supabase);
      if (!business) {
        setMode('demo');
        return;
      }

      const bId = business.id;

      // Run all four queries in parallel
      const [callsRes, apptRes, reqRes, kbRes] = await Promise.all([
        supabase
          .from('calls')
          .select('*', { count: 'exact' })
          .eq('business_id', bId)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('appointments')
          .select('*', { count: 'exact' })
          .eq('business_id', bId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('service_requests')
          .select('*', { count: 'exact' })
          .eq('business_id', bId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('business_knowledge')
          .select('*', { count: 'exact', head: true })
          .eq('business_id', bId),
      ]);

      const errors = [callsRes.error, apptRes.error, reqRes.error, kbRes.error].filter(Boolean);
      if (errors.length > 0) {
        setLoadError(errors.map((e) => e!.message).join('; '));
      }

      setStats({
        callCount: callsRes.count ?? 0,
        pendingAppointmentCount: apptRes.count ?? 0,
        pendingRequestCount: reqRes.count ?? 0,
        knowledgeCount: kbRes.count ?? 0,
        recentCalls: (callsRes.data as DbCall[]) ?? [],
        pendingAppointments: (apptRes.data as DbAppointment[]) ?? [],
        pendingRequests: (reqRes.data as DbServiceRequest[]) ?? [],
      });
      setMode('real');
    }

    load();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="p-6 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (mode === 'demo') return <DemoDashboardPage />;

  return <RealDashboardPage stats={stats} loadError={loadError} />;
}
