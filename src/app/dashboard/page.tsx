'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
    <div className="fd-card px-5 py-5">
      <p className="text-[13px] font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>{label}</p>
      <p
        className="text-[44px] font-semibold tracking-tight leading-none mb-2"
        style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}
      >
        {value}
      </p>
      <p className="text-[12px] leading-snug" style={{ color: 'var(--ink-muted)' }}>{sub}</p>
    </div>
  );
}

const BADGE_COLOR: Record<BadgeColor, string> = {
  amber: 'fd-pill fd-pill-warn',
  red:   'fd-pill fd-pill-danger',
  blue:  'fd-pill fd-pill-info',
};

function PriorityRow({ action, index = 0 }: { action: PriorityAction; index?: number }) {
  return (
    <div
      className="grid grid-cols-[40px_1fr] sm:grid-cols-[44px_1fr_auto] gap-x-4 gap-y-3 px-5 py-4 items-start"
      style={{ borderTop: index === 0 ? 'none' : '1px solid var(--hairline)' }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-semibold"
        style={{ backgroundColor: 'var(--paper-dim)', color: 'var(--ink-soft)' }}
      >
        {action.initials}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            {action.name}
          </span>
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>·</span>
          <span className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            {action.requestType}
          </span>
          <span className={BADGE_COLOR[action.badgeColor]}>{action.badgeLabel}</span>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          {action.summary}
        </p>
      </div>

      <div className="col-start-2 sm:col-start-3 flex flex-row sm:flex-col items-end justify-between sm:justify-start gap-2 sm:gap-3 sm:pt-1">
        <span className="text-[12px] whitespace-nowrap order-2 sm:order-1" style={{ color: 'var(--ink-muted)' }}>
          {action.time}
        </span>
        <Link href={action.actionHref} className="fd-btn fd-btn-accent order-1 sm:order-2 whitespace-nowrap">
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            className="group fd-card p-5 transition-colors hover:border-[#D2D2D7]"
          >
            <div className="flex items-start justify-between mb-3">
              <p className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
                {item.label}
              </p>
              {count != null && count > 0 && (
                <span className="fd-pill fd-pill-warn">{count} new</span>
              )}
            </div>
            <p className="text-[13px] leading-snug mb-6" style={{ color: 'var(--ink-soft)' }}>
              {item.description}
            </p>
            <span className="text-[13px] font-medium inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              Open
              <span className="transition-transform group-hover:translate-x-0.5 inline-block">→</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Shared overview layout ───────────────────────────────────────────────────

function todayLabel(): string {
  return new Date()
    .toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    .toUpperCase();
}

function splitGreeting(greeting: string): { lead: string; name: string } {
  const match = greeting.match(/^(.*?,)\s*(.*?)\.?$/);
  if (!match) return { lead: greeting, name: '' };
  return { lead: match[1], name: match[2] };
}

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
  const { lead, name } = splitGreeting(greeting);

  return (
    <div className="w-full max-w-[1180px] mx-auto px-6 sm:px-10 lg:px-12 pt-8 pb-20 fd-stagger">

      {/* ── Top meta strip ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-8">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[13px] font-medium" style={{ color: 'var(--ink-soft)' }}>{todayLabel()}</span>
          <span style={{ color: 'var(--ink-faint)' }}>·</span>
          {statusPill}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button onClick={onRefresh} disabled={refreshing} className="fd-btn fd-btn-quiet">
              {refreshing ? 'Updating…' : 'Refresh'}
            </button>
          )}
          <Link href="/dashboard/simulator" className="fd-btn fd-btn-primary">
            Try our service →
          </Link>
        </div>
      </div>

      {loadError && (
        <div className="mb-8 px-4 py-3 text-sm" style={{ border: '1px solid var(--danger)', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <strong>Failed to load:</strong> {loadError}
        </div>
      )}

      {/* ── Greeting hero ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-y-8 gap-x-12 items-end mb-14">
        <h1
          className="fd-display text-4xl sm:text-5xl lg:text-6xl"
          style={{ color: 'var(--ink)' }}
        >
          {lead}
          {name && (
            <>
              <br />
              {name}
            </>
          )}
        </h1>
        <div className="flex flex-col lg:items-end gap-3 lg:max-w-[260px]">
          <p className="text-[15px] leading-relaxed lg:text-right" style={{ color: 'var(--ink-soft)' }}>
            {needsAttention > 0 ? (
              <>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>{needsAttention}</span>{' '}
                item{needsAttention !== 1 ? 's' : ''} need staff attention
                {appointmentCount > 0 && (
                  <>
                    {' · '}
                    <span className="whitespace-nowrap" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {appointmentCount} awaiting confirmation
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="font-semibold" style={{ color: 'var(--ok)' }}>
                All clear — nothing needs attention
              </span>
            )}
          </p>
        </div>
      </section>

      {/* ── KPI block ──────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-16">
        <KpiCard label="Calls today" value={callsHandled} sub={callsSub} />
        <KpiCard label="Needs attention" value={needsAttention} sub="across new requests" accent />
        <KpiCard label="Appointments" value={appointmentCount} sub="awaiting confirmation" />
        <KpiCard label="Service requests" value={serviceRequestCount} sub="open for your team" />
      </section>

      {/* ── Priority ───────────────────────────────────────────────────── */}
      <section className="mb-20">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              Priority actions
            </h2>
            <p className="text-[13px] mt-1" style={{ color: 'var(--ink-soft)' }}>
              The urgent items captured by the front desk.
            </p>
          </div>
          {needsAttention > 0 && (
            <Link href="/dashboard/calls" className="text-[13px] font-medium whitespace-nowrap" style={{ color: 'var(--accent)' }}>
              See all {needsAttention} →
            </Link>
          )}
        </div>
        {priorityActions.length === 0 ? (
          <div className="fd-card py-14 text-center">
            <p className="text-2xl font-semibold mb-2" style={{ color: 'var(--ink)' }}>All clear</p>
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              New appointment requests, service requests, and follow-ups will appear here.
            </p>
          </div>
        ) : (
          <div className="fd-card overflow-hidden">
            {priorityActions.map((action, index) => (
              <PriorityRow key={action.id} action={action} index={index} />
            ))}
          </div>
        )}
      </section>

      {/* ── At a glance ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-5">
          <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            At a glance
          </h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-soft)' }}>
            Jump to any section.
          </p>
        </div>
        <GlanceGrid appointmentCount={appointmentCount} requestCount={serviceRequestCount} />
      </section>

      <footer className="mt-16 pt-6 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--hairline)' }}>
        <span className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>Compiled live · staff edition</span>
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--ink-muted)' }}>FrontDesk</span>
      </footer>

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
    <span className="inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--ok)' }}>
      <span className="relative inline-flex w-1.5 h-1.5">
        <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#22c55e', opacity: 0.5 }} />
        <span className="relative inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
      </span>
      Front desk live
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
    <span className="inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--ok)' }}>
      <span className="relative inline-flex w-1.5 h-1.5">
        <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#22c55e', opacity: 0.5 }} />
        <span className="relative inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
      </span>
      Front desk live
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

function DashboardPageInner() {
  const searchParams = useSearchParams();
  const forceDemo = searchParams.get('demo') === '1';

  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    !isSupabaseConfigured || forceDemo ? 'demo' : 'loading',
  );
  const [stats, setStats] = useState<RealStats>(EMPTY_STATS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || forceDemo) return;
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
    if (!isSupabaseConfigured || forceDemo) return;
    load();
  }, [load, forceDemo]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [refreshing, load]);

  if (mode === 'loading') {
    return (
      <div className="w-full max-w-[1180px] mx-auto px-6 sm:px-10 lg:px-12 pt-8 pb-20">
        <div className="pb-3 mb-10 flex items-center justify-between" style={{ borderBottom: '1px solid var(--rule)' }}>
          <div className="h-3 w-40 animate-pulse" style={{ backgroundColor: 'var(--hairline)' }} />
          <div className="h-6 w-28 animate-pulse" style={{ backgroundColor: 'var(--hairline)' }} />
        </div>
        <div className="h-16 sm:h-24 w-3/4 animate-pulse mb-14" style={{ backgroundColor: 'var(--hairline)' }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ backgroundColor: 'var(--hairline)' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40" style={{ backgroundColor: 'var(--surface)' }} />
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

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardPageInner />
    </Suspense>
  );
}
