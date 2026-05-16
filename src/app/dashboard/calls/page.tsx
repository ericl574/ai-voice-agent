'use client';

import { useState, useEffect } from 'react';
import { MOCK_CALLS } from '@/lib/mock-data';
import StatusBadge from '@/components/StatusBadge';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { CallType } from '@/lib/mock-data';

// ─── DB types ──────────────────────────────────────────────────────────────
// Column names are best-guess snake_case; if a query errors, the message
// surfaces in the UI so schema mismatches are immediately visible.

interface DbCall {
  id: string;
  business_id: string;
  // Actual schema columns
  customer_name?: string | null;
  customer_phone?: string | null;
  intent?: string | null;
  // Legacy / alternative column names kept as fallbacks
  caller_name?: string | null;
  caller_phone?: string | null;
  call_type?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  status?: string | null;
  summary?: string | null;
  created_at: string;
}

interface DbCallMessage {
  id: string;
  call_id: string;
  role?: string | null;
  content?: string | null;   // primary guess; fall back below if absent
  created_at: string;
  sequence?: number | null;
}

type TranscriptState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; messages: DbCallMessage[] };

// ─── Helpers ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  reservation:  'bg-blue-100 text-blue-700',
  appointment:  'bg-blue-100 text-blue-700',
  order:        'bg-purple-100 text-purple-700',
  inquiry:      'bg-gray-100 text-gray-600',
  complaint:    'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  resolved:    'bg-green-100 text-green-800',
  escalated:   'bg-red-100 text-red-800',
  missed:      'bg-gray-100 text-gray-600',
  active:      'bg-blue-100 text-blue-700',
  in_progress: 'bg-blue-100 text-blue-700',
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeClass(t: string | null | undefined) {
  if (!t) return 'bg-gray-100 text-gray-500';
  return TYPE_COLORS[t.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

function statusClass(s: string | null | undefined) {
  if (!s) return 'bg-gray-100 text-gray-500';
  return STATUS_STYLES[s.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

function formatDuration(secs: number | null | undefined): string {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  } catch {
    return { date: iso, time: '' };
  }
}

function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Unknown';
  const r = role.toLowerCase();
  if (r === 'ai' || r === 'agent' || r === 'assistant') return 'AI';
  if (r === 'caller' || r === 'user' || r === 'customer') return 'Caller';
  return cap(role);
}

function msgText(msg: DbCallMessage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return m.content ?? m.message ?? m.text ?? '(empty)';
}

// ─── Demo mode ─────────────────────────────────────────────────────────────

const MOCK_TYPE_LABEL: Record<CallType, string> = {
  reservation: 'Reservation',
  order: 'Order',
  inquiry: 'Inquiry',
  complaint: 'Complaint',
};

const MOCK_TYPE_COLOR: Record<CallType, string> = {
  reservation: 'bg-blue-100 text-blue-700',
  order:       'bg-purple-100 text-purple-700',
  inquiry:     'bg-gray-100 text-gray-600',
  complaint:   'bg-red-100 text-red-700',
};

function DemoCallHistoryPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call History</h1>
        <p className="text-sm text-gray-500 mt-1">All calls handled by the AI assistant.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">{MOCK_CALLS.length} calls total</span>
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">
            Demo mode
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date / Time</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Caller</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {MOCK_CALLS.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                    <div>{call.date}</div>
                    <div className="text-xs text-gray-400">{call.time}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{call.callerName}</div>
                    <div className="text-xs text-gray-400">{call.callerPhone}</div>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${MOCK_TYPE_COLOR[call.type]}`}>
                      {MOCK_TYPE_LABEL[call.type]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {call.duration}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <StatusBadge status={call.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{call.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Transcript panel ──────────────────────────────────────────────────────

function TranscriptPanel({ state }: { state: TranscriptState | undefined }) {
  if (!state || state.status === 'loading') {
    return <p className="text-xs text-gray-400 py-2">Loading transcript…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="text-xs text-red-600 py-2">
        <strong>Transcript error:</strong> {state.message}
      </p>
    );
  }
  if (state.messages.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic py-2">No transcript available for this call.</p>
    );
  }
  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
      {state.messages.map((msg) => {
        const label = roleLabel(msg.role);
        const isAI = label === 'AI';
        return (
          <div key={msg.id} className={`flex gap-2 ${isAI ? 'flex-row-reverse' : ''}`}>
            <span
              className={`text-xs font-semibold whitespace-nowrap mt-1.5 ${
                isAI ? 'text-orange-500' : 'text-gray-500'
              }`}
            >
              {label}
            </span>
            <div
              className={`text-xs px-3 py-2 rounded-lg max-w-prose leading-relaxed ${
                isAI
                  ? 'bg-orange-50 text-gray-800'
                  : 'bg-white border border-gray-200 text-gray-700'
              }`}
            >
              {msgText(msg)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Real mode ─────────────────────────────────────────────────────────────

function RealCallHistoryPage({
  calls,
  loadError,
}: {
  calls: DbCall[];
  loadError: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptState>>({});

  async function toggleExpand(callId: string) {
    // Collapse if already open
    if (expandedId === callId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(callId);

    // Already fetched — reuse cached result
    if (transcripts[callId]) return;

    setTranscripts((prev) => ({ ...prev, [callId]: { status: 'loading' } }));

    const supabase = createClient();
    const { data, error } = await supabase
      .from('call_messages')
      .select('*')
      .eq('call_id', callId)
      .order('created_at', { ascending: true });

    if (error) {
      setTranscripts((prev) => ({
        ...prev,
        [callId]: { status: 'error', message: error.message },
      }));
    } else {
      setTranscripts((prev) => ({
        ...prev,
        [callId]: { status: 'loaded', messages: (data as DbCallMessage[]) ?? [] },
      }));
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call History</h1>
        <p className="text-sm text-gray-500 mt-1">All calls handled by the AI assistant.</p>
      </div>

      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load calls:</strong> {loadError}
        </div>
      )}

      {calls.length === 0 && !loadError ? (
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
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
          <p className="text-gray-400 text-sm font-medium">No calls yet</p>
          <p className="text-gray-400 text-xs mt-1">
            Calls handled by your AI assistant will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <span className="text-sm text-gray-500">
              {calls.length} call{calls.length !== 1 ? 's' : ''} total
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date / Time</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Caller</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Summary</th>
                  <th className="px-5 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {calls.flatMap((call) => {
                  const { date, time } = formatDateTime(call.started_at ?? call.created_at);
                  const isExpanded = expandedId === call.id;

                  const mainRow = (
                    <tr
                      key={call.id}
                      onClick={() => toggleExpand(call.id)}
                      className={`border-t border-gray-50 transition-colors cursor-pointer ${
                        isExpanded ? 'bg-orange-50/30' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                        <div>{date}</div>
                        <div className="text-xs text-gray-400">{time}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">
                          {call.customer_name ?? call.caller_name ?? 'Unknown'}
                        </div>
                        <div className="text-xs text-gray-400">
                          {call.customer_phone ?? call.caller_phone ?? ''}
                        </div>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {(call.intent ?? call.call_type) ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeClass(call.intent ?? call.call_type)}`}
                          >
                            {cap(call.intent ?? call.call_type ?? '')}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {call.status ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(call.status)}`}
                          >
                            {cap(call.status)}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500 max-w-xs truncate">
                        {call.summary ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ml-auto ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </td>
                    </tr>
                  );

                  if (!isExpanded) return [mainRow];

                  const expandedRow = (
                    <tr key={`${call.id}-transcript`} className="border-t border-gray-100">
                      <td colSpan={7} className="px-5 py-4 bg-gray-50">
                        <TranscriptPanel state={transcripts[call.id]} />
                      </td>
                    </tr>
                  );

                  return [mainRow, expandedRow];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export default function CallHistoryPage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [calls, setCalls] = useState<DbCall[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function load() {
      const supabase = createClient();

      // Fast cookie-based check — no network round-trip for signed-out users
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

      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });

      if (error) {
        setLoadError(error.message);
      } else {
        setCalls((data as DbCall[]) ?? []);
      }
      setMode('real');
    }

    load();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="p-6 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Call History</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (mode === 'demo') return <DemoCallHistoryPage />;

  return <RealCallHistoryPage calls={calls} loadError={loadError} />;
}
