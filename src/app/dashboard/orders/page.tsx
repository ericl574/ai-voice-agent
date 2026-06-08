'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_ORDERS, RequestStatus } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { useDashboardMode } from '@/lib/dashboard-mode';

// ─── DB types ──────────────────────────────────────────────────────────────

interface DbServiceRequest {
  id: string;
  business_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  request_type?: string | null;
  request_details?: string | null;
  preferred_time?: string | null;
  staff_notes?: string | null;
  service_type?: string | null;
  description?: string | null;
  details?: string | null;
  notes?: string | null;
  total_amount?: number | null;
  call_id?: string | null;
  status: string;
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
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function prettyType(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function requestType(req: DbServiceRequest): string {
  return req.request_type ?? req.service_type ?? '';
}

function detailsText(req: DbServiceRequest): string {
  return req.request_details ?? req.description ?? req.details ?? '';
}

function notesText(req: DbServiceRequest): string {
  const parts = [req.staff_notes, req.notes].filter(Boolean);
  return parts.join(' · ');
}

function customerInitial(name: string | null | undefined): string {
  if (!name) return '·';
  return name.trim()[0]?.toUpperCase() ?? '·';
}

// Apple Contacts-style soft avatar palette
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#E8F0FE', fg: '#1E40AF' },
  { bg: '#E6F4EA', fg: '#166534' },
  { bg: '#FCE7E6', fg: '#9F1239' },
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#E0F2FE', fg: '#075985' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#D1FAE5', fg: '#065F46' },
];

function avatarFor(name: string | null | undefined): { bg: string; fg: string } {
  const safe = (name ?? '').trim();
  let hash = 0;
  for (let i = 0; i < safe.length; i++) hash = (hash * 31 + safe.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// ─── Page header ───────────────────────────────────────────────────────────

function PageHeader({ subtitle, count }: { subtitle: string; count?: number | null }) {
  return (
    <header className="mb-8">
      <h1 className="fd-display text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
        Service requests
      </h1>
      <p className="text-[15px] max-w-2xl leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        {subtitle}
        {count != null && (
          <span style={{ color: 'var(--ink-muted)' }}> · {count} total</span>
        )}
      </p>
    </header>
  );
}

// ─── Reminder strip ────────────────────────────────────────────────────────

function StaffReminderStrip() {
  return (
    <div
      className="mb-6 px-4 py-3 flex items-center gap-3 rounded-[10px]"
      style={{
        backgroundColor: 'var(--warn-soft)',
        border: '1px solid #F3D7A0',
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--warn)' }}>
        Staff reminder
      </span>
      <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
        Requests stay pending until you confirm. The front desk never guarantees fulfilment — always confirm with the customer.
      </span>
    </div>
  );
}

// ─── Filter bar ────────────────────────────────────────────────────────────

function FilterBar({
  filter,
  setFilter,
  countLabel,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  countLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`fd-tab ${filter === f.value ? 'fd-tab-active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="ml-auto text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {countLabel}
      </span>
    </div>
  );
}

// ─── Request card ──────────────────────────────────────────────────────────

function RequestCard({
  customerName,
  customerPhone,
  typeLabel,
  receivedAt,
  preferredTime,
  details,
  notes,
  totalLabel,
  status,
  onConfirm,
  onDecline,
  onReopen,
}: {
  customerName: string | null;
  customerPhone: string | null;
  typeLabel: string;
  receivedAt: string;
  preferredTime?: string | null;
  details: string;
  notes: string;
  totalLabel?: string | null;
  status: RequestStatus;
  onConfirm?: () => void;
  onDecline?: () => void;
  onReopen?: () => void;
}) {
  const isPending = status === 'pending';
  const av = avatarFor(customerName);
  return (
    <article className="fd-card overflow-hidden">
      {/* Top metadata band */}
      <div
        className="px-5 py-3 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
            Received
          </span>
          <span className="text-[13px] fd-numeric" style={{ color: 'var(--ink-2)' }}>{receivedAt}</span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Main row */}
      <div className="px-5 py-5 grid grid-cols-12 gap-x-5 gap-y-4 items-start">
        {/* Customer */}
        <div className="col-span-12 md:col-span-4 flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-[15px] font-semibold"
            style={{ backgroundColor: av.bg, color: av.fg }}
          >
            {customerInitial(customerName)}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight truncate" style={{ color: 'var(--ink)' }}>
              {customerName ?? 'Unknown caller'}
            </p>
            <p className="text-[12px] mt-0.5 fd-numeric" style={{ color: 'var(--ink-muted)' }}>
              {customerPhone ?? 'No phone provided'}
            </p>
          </div>
        </div>

        {/* Type + (optional) total */}
        <div className="col-span-6 md:col-span-3 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Type
          </p>
          <p className="text-[14px] leading-snug" style={{ color: 'var(--ink)' }}>{typeLabel}</p>
          {totalLabel && (
            <p className="text-[12px] mt-1 fd-numeric font-medium" style={{ color: 'var(--ink-2)' }}>
              {totalLabel}
            </p>
          )}
        </div>

        {/* Preferred time / quick info */}
        <div className="col-span-6 md:col-span-3 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Preferred
          </p>
          {preferredTime ? (
            <p className="text-[14px] leading-snug" style={{ color: 'var(--ink)' }}>{preferredTime}</p>
          ) : (
            <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
              Not specified
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="col-span-12 md:col-span-2 flex flex-row md:flex-col gap-2 md:items-stretch">
          {isPending ? (
            <>
              <button onClick={onConfirm} className="fd-btn fd-btn-accent flex-1 md:flex-none">
                Confirm
              </button>
              <button onClick={onDecline} className="fd-btn fd-btn-ghost flex-1 md:flex-none">
                Decline
              </button>
            </>
          ) : (
            <button onClick={onReopen} className="fd-btn fd-btn-quiet flex-1 md:flex-none">
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Details block (full width, larger leading) */}
      {details && (
        <div
          className="px-5 py-4 flex items-start gap-4"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 pt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Details
          </span>
          <p className="text-[13px] leading-relaxed flex-1" style={{ color: 'var(--ink-2)' }}>
            {details}
          </p>
        </div>
      )}

      {/* Notes block */}
      {notes && (
        <div
          className="px-5 py-4 flex items-start gap-4"
          style={{ borderTop: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 pt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Notes
          </span>
          <p className="text-[13px] leading-relaxed flex-1" style={{ color: 'var(--ink-2)' }}>
            {notes}
          </p>
        </div>
      )}
    </article>
  );
}

// ─── Demo mode ─────────────────────────────────────────────────────────────

function DemoOrdersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>(
    () => Object.fromEntries(MOCK_ORDERS.map((o) => [o.id, o.status])),
  );

  const filtered = MOCK_ORDERS.filter(
    (o) => filter === 'all' || statuses[o.id] === filter,
  );

  function updateStatus(id: string, status: RequestStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <PageHeader
        count={MOCK_ORDERS.length}
        subtitle="Service and order requests collected by your front desk. Every one starts pending until your team confirms."
      />
      <StaffReminderStrip />
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        countLabel={`${filtered.length} of ${MOCK_ORDERS.length} · demo`}
      />
      <div className="space-y-4 fd-stagger">
        {filtered.map((order) => {
          const status = statuses[order.id];
          const items = order.items
            .map((i) => `${i.quantity}× ${i.name}`)
            .join(', ');
          return (
            <RequestCard
              key={order.id}
              customerName={order.customerName}
              customerPhone={order.phone}
              typeLabel="Order"
              receivedAt={order.requestedAt}
              preferredTime={null}
              details={items}
              notes={order.notes ?? ''}
              totalLabel={`$${order.total.toFixed(2)}`}
              status={status}
              onConfirm={() => updateStatus(order.id, 'confirmed')}
              onDecline={() => updateStatus(order.id, 'declined')}
              onReopen={() => updateStatus(order.id, 'pending')}
            />
          );
        })}
        {filtered.length === 0 && (
          <div className="fd-card px-6 py-14 text-center">
            <p className="text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Nothing here</p>
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              No orders match this filter.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Real mode ─────────────────────────────────────────────────────────────

function RealServiceRequestsPage({
  requests: initial,
  loadError,
  businessId,
}: {
  requests: DbServiceRequest[];
  loadError: string | null;
  businessId: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, string>>(
    () => Object.fromEntries(initial.map((r) => [r.id, r.status])),
  );
  const [updateError, setUpdateError] = useState<string | null>(null);

  const filtered = initial.filter((r) => {
    const s = statuses[r.id] ?? r.status;
    return filter === 'all' || s === filter;
  });

  async function updateStatus(id: string, newStatus: RequestStatus) {
    setStatuses((prev) => ({ ...prev, [id]: newStatus }));
    setUpdateError(null);

    const supabase = createClient();
    const { error } = await supabase
      .from('service_requests')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) {
      setStatuses((prev) => ({
        ...prev,
        [id]: initial.find((r) => r.id === id)?.status ?? prev[id],
      }));
      setUpdateError(`Failed to update status: ${error.message}`);
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <PageHeader
        count={initial.length}
        subtitle="Service and order requests collected by your front desk. Every one starts pending until your team confirms."
      />
      <StaffReminderStrip />

      {loadError && (
        <div className="mb-6 px-4 py-3 text-sm rounded-[10px]" style={{ border: '1px solid var(--danger)', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <strong>Failed to load requests:</strong> {loadError}
        </div>
      )}
      {updateError && (
        <div className="mb-6 px-4 py-3 text-sm rounded-[10px]" style={{ border: '1px solid var(--danger)', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {updateError}
        </div>
      )}

      {initial.length === 0 && !loadError ? (
        <div className="fd-card px-6 py-16 text-center">
          <p className="fd-display text-3xl mb-2" style={{ color: 'var(--ink)' }}>No requests yet</p>
          <p className="text-[15px]" style={{ color: 'var(--ink-soft)' }}>
            Service and order requests captured by your front desk will appear here.
          </p>
        </div>
      ) : (
        <>
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            countLabel={`${filtered.length} of ${initial.length}`}
          />
          <div className="space-y-4 fd-stagger">
            {filtered.map((req) => {
              const status = (statuses[req.id] ?? req.status) as RequestStatus;
              const rawType = requestType(req);
              const typeLabel = rawType ? prettyType(rawType) : 'Service request';
              return (
                <RequestCard
                  key={req.id}
                  customerName={req.customer_name ?? null}
                  customerPhone={req.customer_phone ?? null}
                  typeLabel={typeLabel}
                  receivedAt={formatCreatedAt(req.created_at)}
                  preferredTime={req.preferred_time ?? null}
                  details={detailsText(req)}
                  notes={notesText(req)}
                  totalLabel={req.total_amount != null ? `$${req.total_amount.toFixed(2)}` : null}
                  status={status}
                  onConfirm={() => updateStatus(req.id, 'confirmed')}
                  onDecline={() => updateStatus(req.id, 'declined')}
                  onReopen={() => updateStatus(req.id, 'pending')}
                />
              );
            })}
            {filtered.length === 0 && (
              <div className="fd-card px-6 py-14 text-center">
                <p className="text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Nothing here</p>
                <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
                  No requests match this filter.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { isDemo } = useDashboardMode();
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isDemo ? 'demo' : 'loading',
  );
  const [requests, setRequests] = useState<DbServiceRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string>('');

  useEffect(() => {
    if (isDemo || !isSupabaseConfigured) return;

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
        .from('service_requests')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });
      if (error) {
        setLoadError(error.message);
      } else {
        setRequests((data as DbServiceRequest[]) ?? []);
      }
      setMode('real');
    }

    load();
  }, [isDemo]);

  if (mode === 'loading') {
    return (
      <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
        <div className="h-3 w-32 mb-4 animate-pulse rounded-sm" style={{ backgroundColor: 'var(--hairline)' }} />
        <div className="h-12 w-2/3 mb-8 animate-pulse rounded-sm" style={{ backgroundColor: 'var(--hairline)' }} />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 fd-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'demo') return <DemoOrdersPage />;

  return (
    <RealServiceRequestsPage
      requests={requests}
      loadError={loadError}
      businessId={businessId}
    />
  );
}
