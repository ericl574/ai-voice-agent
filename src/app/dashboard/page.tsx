'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MOCK_CALLS, MOCK_RESERVATIONS, MOCK_ORDERS, MOCK_RESTAURANT } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

// ─── DB types ─────────────────────────────────────────────────────────────────

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
  businessName: string;
  callCount: number;
  todayCallCount: number;
  pendingAppointmentCount: number;
  pendingRequestCount: number;
  pendingAppointments: DbAppointment[];
  pendingRequests: DbServiceRequest[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortName(name: string): string {
  const skip = new Set(['the', 'a', 'an']);
  return name.split(' ').find((w) => !skip.has(w.toLowerCase())) ?? name.split(' ')[0];
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return iso;
  }
}

// ─── Priority action type ─────────────────────────────────────────────────────

type BadgeColor = 'amber' | 'red' | 'blue';

interface PriorityAction {
  id: string;
  initials: string;
  name: string;
  requestType: string;
  badgeLabel: string;
  badgeColor: BadgeColor;
  summary: string;
  time: string;
  actionLabel: string;
  actionHref: string;
}

// ─── Demo constants ───────────────────────────────────────────────────────────

const TODAY_STR = '2026-05-15';
const todaysCalls = MOCK_CALLS.filter((c) => c.date === TODAY_STR);
const pendingReservations = MOCK_RESERVATIONS.filter((r) => r.status === 'pending');
const pendingOrders = MOCK_ORDERS.filter((o) => o.status === 'pending');

const DEMO_ACTIONS: PriorityAction[] = [
  {
    id: 'demo-1',
    initials: 'SM',
    name: 'Sarah Mitchell',
    requestType: 'Appointment request',
    badgeLabel: 'High priority',
    badgeColor: 'amber',
    summary: 'Party of 4, May 17 at 7:30 PM. One high chair needed.',
    time: 'Today, 12:34 PM',
    actionLabel: 'Confirm appointment',
    actionHref: '/dashboard/reservations',
  },
  {
    id: 'demo-2',
    initials: 'ED',
    name: 'Emma Davis',
    requestType: 'Appointment request',
    badgeLabel: 'High priority',
    badgeColor: 'amber',
    summary: 'Party of 2, May 18 at 8:00 PM. Anniversary dinner — candles requested.',
    time: 'Yesterday, 7:45 PM',
    actionLabel: 'Confirm appointment',
    actionHref: '/dashboard/reservations',
  },
  {
    id: 'demo-3',
    initials: 'RC',
    name: 'Robert Chen',
    requestType: 'Complaint',
    badgeLabel: 'Needs callback',
    badgeColor: 'red',
    summary: 'Unhappy with a previous visit. Requested staff follow-up.',
    time: 'Today, 9:58 AM',
    actionLabel: 'Call back',
    actionHref: '/dashboard/calls',
  },
];

// ─── Real mode priority builder ───────────────────────────────────────────────

function buildRealPriorityActions(
  appointments: DbAppointment[],
  requests: DbServiceRequest[],
): PriorityAction[] {
  const actions: PriorityAction[] = [];

  for (const a of appointments.slice(0, 3)) {
    const name = a.customer_name ?? 'Customer';
    const parts = [
      a.appointment_date,
      a.appointment_time ? `at ${a.appointment_time}` : null,
      a.party_size ? `party of ${a.party_size}` : null,
    ].filter(Boolean);
    actions.push({
      id: a.id,
      initials: initials(name),
      name,
      requestType: a.service_type ?? 'Appointment request',
      badgeLabel: 'High priority',
      badgeColor: 'amber',
      summary: parts.length > 0 ? parts.join(', ') : 'Appointment pending confirmation.',
      time: formatRelativeTime(a.created_at),
      actionLabel: 'Confirm appointment',
      actionHref: '/dashboard/reservations',
    });
  }

  const remaining = Math.max(0, 3 - actions.length);
  for (const r of requests.slice(0, remaining)) {
    const name = r.customer_name ?? 'Customer';
    actions.push({
      id: r.id,
      initials: initials(name),
      name,
      requestType: r.request_type ?? 'Service request',
      badgeLabel: 'Needs action',
      badgeColor: 'blue',
      summary: r.request_details?.slice(0, 90) ?? 'Service request pending review.',
      time: formatRelativeTime(r.created_at),
      actionLabel: 'View request',
      actionHref: '/dashboard/orders',
    });
  }

  return actions.slice(0, 3);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <p className="text-xs font-medium text-gray-500 mb-2 leading-tight">{label}</p>
      <p className={`text-3xl font-bold mb-1 ${accent ? 'text-orange-500' : 'text-gray-900'}`}>
        {value}
      </p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  );
}

const BADGE_STYLES: Record<BadgeColor, string> = {
  amber: 'bg-orange-50 text-orange-700 border-orange-300',
  red: 'bg-rose-50 text-rose-700 border-rose-300',
  blue: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-teal-100 text-teal-700',
];

function PriorityRow({ action, index = 0 }: { action: PriorityAction; index?: number }) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <div className="px-5 py-4 flex items-start gap-3 sm:gap-4">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${avatarColor}`}>
        <span className="font-semibold text-xs">{action.initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5">
          <span className="text-sm font-semibold text-gray-900">{action.name}</span>
          <span className="text-xs text-gray-400">{action.requestType}</span>
          <span
            className={`inline-block border text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_STYLES[action.badgeColor]}`}
          >
            {action.badgeLabel}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate">{action.summary}</p>
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0 ml-1">
        <span className="text-xs text-gray-400 whitespace-nowrap">{action.time}</span>
        <Link
          href={action.actionHref}
          className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        >
          {action.actionLabel} →
        </Link>
      </div>
    </div>
  );
}

const GLANCE_ITEMS = [
  {
    label: 'Call history',
    description: 'Full transcripts and summaries',
    href: '/dashboard/calls',
    countKey: null as null | 'appointments' | 'requests',
  },
  {
    label: 'Appointments',
    description: 'Pending confirmation',
    href: '/dashboard/reservations',
    countKey: 'appointments' as const,
  },
  {
    label: 'Service requests',
    description: 'Open for your team',
    href: '/dashboard/orders',
    countKey: 'requests' as const,
  },
  {
    label: 'Knowledge base',
    description: 'FAQs and business info',
    href: '/dashboard/knowledge',
    countKey: null,
  },
];

function GlanceGrid({
  appointmentCount,
  requestCount,
}: {
  appointmentCount: number;
  requestCount: number;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {GLANCE_ITEMS.map((item) => {
        const count =
          item.countKey === 'appointments'
            ? appointmentCount
            : item.countKey === 'requests'
            ? requestCount
            : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 hover:border-orange-200 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-1.5">
              <span className="text-sm font-semibold text-gray-900 group-hover:text-orange-600 transition-colors leading-tight">
                {item.label}
              </span>
              {count != null && count > 0 && (
                <span className="ml-2 flex-shrink-0 text-[10px] font-bold bg-orange-50 text-orange-500 border border-orange-200 rounded-full w-5 h-5 flex items-center justify-center">{count}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-3">{item.description}</p>
            <span className="text-xs font-medium text-orange-400 group-hover:text-orange-600 transition-colors">
              View →
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Shared overview layout ───────────────────────────────────────────────────

function OverviewLayout({
  greeting,
  statusPill,
  callsHandled,
  callsSub,
  needsAttention,
  appointmentCount,
  serviceRequestCount,
  priorityActions,
  onRefresh,
  refreshing,
  loadError,
}: {
  greeting: string;
  statusPill: React.ReactNode;
  callsHandled: number;
  callsSub: string;
  needsAttention: number;
  appointmentCount: number;
  serviceRequestCount: number;
  priorityActions: PriorityAction[];
  onRefresh?: () => void;
  refreshing?: boolean;
  loadError?: string | null;
}) {
  return (
    <div className="w-full max-w-[1120px] mx-auto px-8 py-8 sm:px-10 lg:px-12">

      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700">
          <strong>Failed to load data:</strong> {loadError}
        </div>
      )}

      {/* Status + greeting + actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-7">
        <div>
          <div className="mb-3">{statusPill}</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1.5">
            {greeting}
          </h1>
          {needsAttention > 0 ? (
            <p className="text-sm text-gray-500">
              {needsAttention} item{needsAttention !== 1 ? 's' : ''} need staff attention
              {appointmentCount > 0 && (
                <>
                  {' · '}
                  <span className="text-orange-600 font-medium">
                    {appointmentCount} need{appointmentCount === 1 ? 's' : ''} confirmation
                  </span>
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-green-600 font-medium">
              All clear — no items need attention.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          )}
          <Link
            href="/dashboard/simulator"
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-xl shadow-sm shadow-orange-500/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Try our service
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <KpiCard label="Calls handled today" value={callsHandled} sub={callsSub} />
        <KpiCard
          label="Needs staff attention"
          value={needsAttention}
          sub="across new requests"
          accent
        />
        <KpiCard
          label="Appointment requests"
          value={appointmentCount}
          sub="awaiting confirmation"
        />
        <KpiCard label="Service requests" value={serviceRequestCount} sub="open for your team" />
      </div>

      {/* Priority actions */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Priority actions</h2>
          {needsAttention > 0 && (
            <Link
              href="/dashboard/calls"
              className="text-sm text-orange-500 hover:text-orange-600 font-medium"
            >
              See all {needsAttention} →
            </Link>
          )}
        </div>
        <p className="px-5 pt-3 pb-1 text-xs text-gray-400">
          The most urgent items captured by the front desk.
        </p>
        {priorityActions.length === 0 ? (
          <div className="px-5 py-6">
              <div className="mx-auto max-w-md rounded-xl border border-green-100 bg-green-50/50 px-5 py-4 text-center">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  All clear — no staff actions needed.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  New appointment requests, service requests, and follow-ups will appear here.
                </p>
              </div>
            </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {priorityActions.map((action, index) => (
              <PriorityRow key={action.id} action={action} index={index} />
            ))}
          </div>
        )}
      </div>

      {/* At a glance */}
      <div>
        <div className="mb-4">
          <h2 className="font-semibold text-gray-900">At a glance</h2>
          <p className="text-xs text-gray-400 mt-0.5">Jump to the detail page for any area.</p>
        </div>
        <GlanceGrid appointmentCount={appointmentCount} requestCount={serviceRequestCount} />
      </div>

    </div>
  );
}

// ─── Demo mode ────────────────────────────────────────────────────────────────

function DemoOverviewPage() {
  const [greeting, setGreeting] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    setGreeting(`Good ${part}, ${shortName(MOCK_RESTAURANT.name)}.`);
  }, []);

  function handleDemoRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }

  const needsAttention = pendingReservations.length + pendingOrders.length;

  const statusPill = (
    <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      Front desk active
    </span>
  );

  return (
    <OverviewLayout
      greeting={greeting || `Good afternoon, ${shortName(MOCK_RESTAURANT.name)}.`}
      statusPill={statusPill}
      callsHandled={todaysCalls.length}
      callsSub={`${todaysCalls.filter((c) => c.status === 'resolved').length} answered`}
      needsAttention={needsAttention}
      appointmentCount={pendingReservations.length}
      serviceRequestCount={pendingOrders.length}
      priorityActions={DEMO_ACTIONS}
      onRefresh={handleDemoRefresh}
      refreshing={refreshing}
    />
  );
}

// ─── Real mode ────────────────────────────────────────────────────────────────

function RealOverviewPage({
  stats,
  loadError,
  onRefresh,
  refreshing,
}: {
  stats: RealStats;
  loadError: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const name = stats.businessName ? shortName(stats.businessName) : 'there';
    setGreeting(`Good ${part}, ${name}.`);
  }, [stats.businessName]);

  const needsAttention = stats.pendingAppointmentCount + stats.pendingRequestCount;
  const priorityActions = buildRealPriorityActions(
    stats.pendingAppointments,
    stats.pendingRequests,
  );

  const statusPill = (
    <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      Front desk active
    </span>
  );

  return (
    <OverviewLayout
      greeting={greeting}
      statusPill={statusPill}
      callsHandled={stats.todayCallCount || stats.callCount}
      callsSub={stats.todayCallCount > 0 ? 'handled today' : 'total logged'}
      needsAttention={needsAttention}
      appointmentCount={stats.pendingAppointmentCount}
      serviceRequestCount={stats.pendingRequestCount}
      priorityActions={priorityActions}
      onRefresh={onRefresh}
      refreshing={refreshing}
      loadError={loadError}
    />
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

const EMPTY_STATS: RealStats = {
  businessName: '',
  callCount: 0,
  todayCallCount: 0,
  pendingAppointmentCount: 0,
  pendingRequestCount: 0,
  pendingAppointments: [],
  pendingRequests: [],
};

export default function DashboardPage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo',
  );
  const [stats, setStats] = useState<RealStats>(EMPTY_STATS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
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

    const bId = business.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [callsRes, todayCallsRes, apptRes, reqRes] = await Promise.all([
      supabase
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', bId),
      supabase
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', bId)
        .gte('created_at', todayStart.toISOString()),
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
    ]);

    const errors = [callsRes.error, apptRes.error, reqRes.error].filter(Boolean);
    if (errors.length > 0) {
      setLoadError(errors.map((e) => e!.message).join('; '));
    } else {
      setLoadError(null);
    }

    setStats({
      businessName: business.name,
      callCount: callsRes.count ?? 0,
      todayCallCount: todayCallsRes.count ?? 0,
      pendingAppointmentCount: apptRes.count ?? 0,
      pendingRequestCount: reqRes.count ?? 0,
      pendingAppointments: (apptRes.data as DbAppointment[]) ?? [],
      pendingRequests: (reqRes.data as DbServiceRequest[]) ?? [],
    });
    setMode('real');
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [refreshing, load]);

  if (mode === 'loading') {
    return (
      <div className="w-full max-w-[1120px] mx-auto px-8 py-8 sm:px-10 lg:px-12">
        <div className="w-32 h-6 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="w-64 h-9 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'demo') return <DemoOverviewPage />;

  return (
    <RealOverviewPage
      stats={stats}
      loadError={loadError}
      onRefresh={handleRefresh}
      refreshing={refreshing}
    />
  );
}
