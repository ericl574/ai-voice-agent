'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_ORDERS, RequestStatus } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

// ─── DB types ──────────────────────────────────────────────────────────────
// Flexible optional fields so any schema mismatch shows as a visible error
// rather than a silent crash. Multiple column name guesses are kept as
// fallbacks until the real schema is confirmed.

interface DbServiceRequest {
  id: string;
  business_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  // Real schema columns
  request_type?: string | null;
  request_details?: string | null;
  preferred_time?: string | null;
  staff_notes?: string | null;
  // Backwards-compatible fallbacks from initial implementation
  service_type?: string | null;
  description?: string | null;
  details?: string | null;
  notes?: string | null;
  total_amount?: number | null;
  // Relations
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
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
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

// ─── Demo mode ─────────────────────────────────────────────────────────────

function DemoOrdersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>(
    () => Object.fromEntries(MOCK_ORDERS.map((o) => [o.id, o.status]))
  );

  const filtered = MOCK_ORDERS.filter(
    (o) => filter === 'all' || statuses[o.id] === filter
  );

  function updateStatus(id: string, status: RequestStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          Service and order requests collected by the AI assistant.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-5">
        <strong>Staff reminder:</strong> All requests are pending until confirmed. The AI never guarantees fulfilment — always confirm with the customer.
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
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((order) => {
                const status = statuses[order.id];
                return (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{order.requestedAt}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{order.customerName}</div>
                      <div className="text-xs text-gray-400">{order.phone}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      <ul className="space-y-0.5">
                        {order.items.map((item, i) => (
                          <li key={i} className="text-xs">
                            {item.quantity}× {item.name}{' '}
                            <span className="text-gray-400">(${item.price.toFixed(2)})</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-5 py-3 text-gray-700 whitespace-nowrap font-medium">
                      ${order.total.toFixed(2)}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs text-xs">
                      {order.notes || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateStatus(order.id, 'confirmed')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => updateStatus(order.id, 'declined')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => updateStatus(order.id, 'pending')}
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
                    No orders match this filter.
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
    () => Object.fromEntries(initial.map((r) => [r.id, r.status]))
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
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          Service and order requests collected by the AI assistant.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-5">
        <strong>Staff reminder:</strong> Requests are pending until confirmed. The AI never guarantees fulfilment — always confirm with the customer.
      </div>

      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load requests:</strong> {loadError}
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-gray-400 text-sm font-medium">No service requests yet</p>
          <p className="text-gray-400 text-xs mt-1">
            Service and order requests from AI-handled calls will appear here.
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
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Service Type</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((req) => {
                  const status = (statuses[req.id] ?? req.status) as RequestStatus;
                  const details = detailsText(req);
                  const notes = notesText(req);
                  return (
                    <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatCreatedAt(req.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">
                          {req.customer_name ?? <span className="text-gray-400">Unknown</span>}
                        </div>
                        <div className="text-xs text-gray-400">{req.customer_phone ?? ''}</div>
                      </td>
                      <td className="px-5 py-3 text-gray-700 whitespace-nowrap">
                        {requestType(req) ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                            {requestType(req)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs max-w-xs">
                        {details || <span className="text-gray-300">—</span>}
                        {req.preferred_time && (
                          <div className="text-gray-400 mt-0.5">Preferred: {req.preferred_time}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-5 py-3 text-gray-500 max-w-xs text-xs">
                        {notes || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {status === 'pending' ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatus(req.id, 'confirmed')}
                              className="text-xs font-medium px-2.5 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => updateStatus(req.id, 'declined')}
                              className="text-xs font-medium px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                            >
                              Decline
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => updateStatus(req.id, 'pending')}
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

export default function OrdersPage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [requests, setRequests] = useState<DbServiceRequest[]>([]);
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
  }, []);

  if (mode === 'loading') {
    return (
      <div className="p-6 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Service Requests</h1>
        <p className="text-sm text-gray-400">Loading…</p>
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
