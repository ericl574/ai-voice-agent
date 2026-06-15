'use client';

import { useState, useEffect } from 'react';
import { MOCK_CALLS } from '@/lib/mock-data';
import StatusBadge from '@/components/StatusBadge';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { useDashboardMode } from '@/lib/dashboard-mode';
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
  transcript?: string | null;
  // Legacy / alternative column names kept as fallbacks
  caller_name?: string | null;
  caller_phone?: string | null;
  call_type?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  status?: string | null;
  summary?: string | null;
  needs_staff_followup?: boolean | null;
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

const TYPE_PILL: Record<string, string> = {
  reservation:         'fd-pill fd-pill-info',
  appointment:         'fd-pill fd-pill-info',
  appointment_request: 'fd-pill fd-pill-info',
  order:               'fd-pill fd-pill-info',
  service_request:     'fd-pill fd-pill-info',
  quote_request:       'fd-pill fd-pill-info',
  inquiry:             'fd-pill fd-pill-muted',
  general_question:    'fd-pill fd-pill-muted',
  complaint:           'fd-pill fd-pill-danger',
};

const STATUS_PILL: Record<string, string> = {
  resolved:    'fd-pill fd-pill-ok',
  escalated:   'fd-pill fd-pill-danger',
  missed:      'fd-pill fd-pill-muted',
  active:      'fd-pill fd-pill-info',
  in_progress: 'fd-pill fd-pill-info',
  pending:     'fd-pill fd-pill-warn',
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typePillClass(t: string | null | undefined) {
  if (!t) return 'fd-pill fd-pill-muted';
  return TYPE_PILL[t.toLowerCase()] ?? 'fd-pill fd-pill-muted';
}

function statusPillClass(s: string | null | undefined) {
  if (!s) return 'fd-pill fd-pill-muted';
  return STATUS_PILL[s.toLowerCase()] ?? 'fd-pill fd-pill-muted';
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
  if (r === 'ai' || r === 'agent' || r === 'assistant' || r === 'front_desk') return 'Front desk';
  if (r === 'caller' || r === 'user' || r === 'customer') return 'Caller';
  return cap(role);
}

function msgText(msg: DbCallMessage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return m.content ?? m.message ?? m.text ?? '(empty)';
}

// ─── Energy helpers ────────────────────────────────────────────────────────
// Deterministic avatar palette — Apple Contacts style soft pastels, picked by name hash.

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#E8F0FE', fg: '#1E40AF' }, // blue
  { bg: '#E6F4EA', fg: '#166534' }, // green
  { bg: '#FCE7E6', fg: '#9F1239' }, // rose
  { bg: '#FEF3C7', fg: '#92400E' }, // amber
  { bg: '#EDE9FE', fg: '#5B21B6' }, // violet
  { bg: '#E0F2FE', fg: '#075985' }, // sky
  { bg: '#FCE7F3', fg: '#9D174D' }, // pink
  { bg: '#D1FAE5', fg: '#065F46' }, // emerald
];

function avatarFor(name: string | null | undefined): { initials: string; bg: string; fg: string } {
  const safe = (name ?? '').trim();
  let hash = 0;
  for (let i = 0; i < safe.length; i++) hash = (hash * 31 + safe.charCodeAt(i)) >>> 0;
  const palette = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  const initials = safe ? safe.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '·';
  return { initials, ...palette };
}

function dateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateGroupLabel(iso: string | null | undefined): { key: number; label: string } {
  const d = dateOnly(iso);
  if (!d) return { key: 0, label: 'Unknown' };
  const today = startOfDay(new Date());
  const dayStart = startOfDay(d);
  const diffDays = Math.round((today - dayStart) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return { key: dayStart, label: 'Today' };
  if (diffDays === 1) return { key: dayStart, label: 'Yesterday' };
  if (diffDays < 7) return { key: dayStart, label: d.toLocaleDateString('en-US', { weekday: 'long' }) };
  return { key: dayStart, label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) };
}

function groupCallsByDate(calls: DbCall[]): Array<{ key: number; label: string; calls: DbCall[] }> {
  const groups = new Map<number, { key: number; label: string; calls: DbCall[] }>();
  for (const c of calls) {
    const { key, label } = dateGroupLabel(c.started_at ?? c.created_at);
    const g = groups.get(key);
    if (g) g.calls.push(c);
    else groups.set(key, { key, label, calls: [c] });
  }
  return Array.from(groups.values()).sort((a, b) => b.key - a.key);
}

function computeStats(calls: DbCall[]): {
  today: number;
  total: number;
  avgLabel: string;
  resolvedPct: number;
} {
  const todayStart = startOfDay(new Date());
  let today = 0;
  let durationSum = 0;
  let durationCount = 0;
  let resolved = 0;
  for (const c of calls) {
    const d = dateOnly(c.started_at ?? c.created_at);
    if (d && startOfDay(d) === todayStart) today++;
    if (typeof c.duration_seconds === 'number') {
      durationSum += c.duration_seconds;
      durationCount++;
    }
    if (c.status === 'resolved') resolved++;
  }
  const avgSec = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;
  const m = Math.floor(avgSec / 60);
  const s = avgSec % 60;
  const avgLabel = durationCount > 0 ? `${m}:${s.toString().padStart(2, '0')}` : '—';
  const resolvedPct = calls.length > 0 ? Math.round((resolved / calls.length) * 100) : 0;
  return { today, total: calls.length, avgLabel, resolvedPct };
}

function StatStrip({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const items = [
    { label: 'Today', value: String(stats.today), accent: stats.today > 0 },
    { label: 'Total', value: String(stats.total) },
    { label: 'Avg duration', value: stats.avgLabel },
    { label: 'Resolved', value: `${stats.resolvedPct}%`, success: stats.resolvedPct >= 80 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
      {items.map((item) => (
        <div key={item.label} className="fd-card px-4 py-4">
          <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--ink-soft)' }}>
            {item.label}
          </p>
          <p
            className="text-[28px] font-semibold tracking-tight leading-none"
            style={{
              color: item.accent ? 'var(--accent)' : item.success ? 'var(--ok)' : 'var(--ink)',
            }}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function CallRow({
  call,
  expanded,
  onToggle,
  transcript,
}: {
  call: DbCall;
  expanded: boolean;
  onToggle: () => void;
  transcript: TranscriptState | undefined;
}) {
  const name = call.customer_name ?? call.caller_name ?? 'Unknown caller';
  const phone = call.customer_phone ?? call.caller_phone ?? '';
  const av = avatarFor(name);
  const { time } = formatDateTime(call.started_at ?? call.created_at);
  const type = call.intent ?? call.call_type;
  const status = call.status;

  return (
    <div
      className="fd-card overflow-hidden transition-shadow hover:shadow-sm"
      style={{ backgroundColor: expanded ? 'var(--surface-soft)' : undefined }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-start gap-4 group"
      >
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-semibold mt-0.5"
          style={{ backgroundColor: av.bg, color: av.fg }}
        >
          {av.initials}
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
            <span className="text-[15px] font-semibold tracking-tight truncate" style={{ color: 'var(--ink)' }}>
              {name}
            </span>
            {phone && (
              <span className="text-[12px] fd-numeric" style={{ color: 'var(--ink-muted)' }}>
                {phone}
              </span>
            )}
            {type && (
              <>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <span className={typePillClass(type)}>
                  {cap(type.replace(/_/g, ' '))}
                </span>
              </>
            )}
          </div>
          <p className="text-[13px] leading-relaxed line-clamp-2" style={{ color: 'var(--ink-soft)' }}>
            {call.summary ?? 'No summary.'}
          </p>
        </div>

        {/* Meta column */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
          {call.needs_staff_followup && (
            <span className="fd-pill fd-pill-warn">Follow-up</span>
          )}
          {status && <span className={statusPillClass(status)}>{cap(status)}</span>}
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            <span className="fd-numeric">{time}</span>
            <span>·</span>
            <span className="fd-numeric">{formatDuration(call.duration_seconds)}</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : 'group-hover:translate-x-0.5'}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={expanded ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded transcript */}
      {expanded && (
        <div className="px-5 pb-5 pt-1" style={{ borderTop: '1px solid var(--hairline)' }}>
          <TranscriptPanel
            state={transcript}
            isTestCall={call.customer_name === 'Test call'}
            callTranscript={call.transcript}
          />
        </div>
      )}
    </div>
  );
}

// ─── Demo mode ─────────────────────────────────────────────────────────────

const MOCK_TYPE_LABEL: Record<CallType, string> = {
  reservation: 'Reservation',
  order: 'Order',
  inquiry: 'Inquiry',
  complaint: 'Complaint',
};

const MOCK_TYPE_PILL: Record<CallType, string> = {
  reservation: 'fd-pill fd-pill-info',
  order:       'fd-pill fd-pill-info',
  inquiry:     'fd-pill fd-pill-muted',
  complaint:   'fd-pill fd-pill-danger',
};

function CallsPageHeader({ count, demo }: { count: number; demo?: boolean }) {
  return (
    <header className="mb-8">
      <h1 className="fd-display text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
        Call history
      </h1>
      <p className="text-[15px] max-w-xl leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        Every call answered by your front desk. Tap a row to expand the transcript.
        {' '}<span style={{ color: 'var(--ink-muted)' }}>· {count} total{demo ? ' · Demo' : ''}</span>
      </p>
    </header>
  );
}

function DemoCallHistoryPage() {
  return (
    <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <CallsPageHeader count={MOCK_CALLS.length} demo />
      <div className="space-y-2 fd-stagger">
        {MOCK_CALLS.map((call) => {
          const av = avatarFor(call.callerName);
          return (
            <div key={call.id} className="fd-card px-5 py-4 flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-semibold mt-0.5"
                style={{ backgroundColor: av.bg, color: av.fg }}
              >
                {av.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                  <span className="text-[15px] font-semibold tracking-tight truncate" style={{ color: 'var(--ink)' }}>
                    {call.callerName}
                  </span>
                  <span className="text-[12px] fd-numeric" style={{ color: 'var(--ink-muted)' }}>
                    {call.callerPhone}
                  </span>
                  <span style={{ color: 'var(--ink-faint)' }}>·</span>
                  <span className={MOCK_TYPE_PILL[call.type]}>{MOCK_TYPE_LABEL[call.type]}</span>
                </div>
                <p className="text-[13px] leading-relaxed line-clamp-2" style={{ color: 'var(--ink-soft)' }}>
                  {call.summary}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                <StatusBadge status={call.status} />
                <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  <span className="fd-numeric">{call.time}</span>
                  <span>·</span>
                  <span className="fd-numeric">{call.duration}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Transcript panel ──────────────────────────────────────────────────────

function TranscriptPanel({
  state,
  isTestCall,
  callTranscript,
}: {
  state: TranscriptState | undefined;
  isTestCall?: boolean;
  callTranscript?: string | null;
}) {
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
    // Fall back to raw transcript text column if call_messages are empty
    const raw = callTranscript?.trim();
    const hasContent =
      raw &&
      raw.length > 0 &&
      !raw.startsWith('(no transcript') &&
      !raw.startsWith('No transcript') &&
      !raw.startsWith('Call recorded');
    if (hasContent) {
      // Parse "Front desk:" / "Caller:" prefixed lines into role-aware bubbles
      const parsedLines = raw!.split('\n').map((line) => {
        const fdMatch = line.match(/^(Front desk|AI|Assistant):\s*/i);
        const callerMatch = line.match(/^(Caller|Customer|User):\s*/i);
        if (fdMatch) return { role: 'assistant' as const, text: line.slice(fdMatch[0].length).trim() };
        if (callerMatch) return { role: 'user' as const, text: line.slice(callerMatch[0].length).trim() };
        return null;
      }).filter((l): l is { role: 'assistant' | 'user'; text: string } => l !== null && l.text.length > 0);

      if (parsedLines.length > 0) {
        return (
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
            {parsedLines.map((line, idx) => {
              const label = line.role === 'assistant' ? 'Front desk' : 'Caller';
              const isAI = line.role === 'assistant';
              // Front desk (agent) on the LEFT, caller on the RIGHT — staff reads the
              // conversation as a third party reviewing what the business said vs the customer.
              return (
                <div key={idx} className={`flex gap-2 ${isAI ? '' : 'flex-row-reverse'}`}>
                  <span className={`text-xs font-semibold whitespace-nowrap mt-1.5 ${isAI ? 'text-orange-500' : 'text-gray-500'}`}>
                    {label}
                  </span>
                  <div className={`text-xs px-3 py-2 rounded-lg max-w-prose leading-relaxed ${
                    isAI ? 'bg-orange-50 text-gray-800' : 'bg-white border fd-hairline-strong text-gray-700'
                  }`}>
                    {line.text}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
          <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">{raw}</pre>
        </div>
      );
    }
    return (
      <p className="text-xs text-gray-400 italic py-2">
        {isTestCall
          ? 'No transcript captured for this test call.'
          : 'No transcript available for this call.'}
      </p>
    );
  }
  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
      {state.messages.map((msg) => {
        const label = roleLabel(msg.role);
        const isAI = label === 'Front desk';
        // Front desk (agent) on the LEFT, caller on the RIGHT — staff perspective.
        return (
          <div key={msg.id} className={`flex gap-2 ${isAI ? '' : 'flex-row-reverse'}`}>
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
                  : 'bg-white border fd-hairline-strong text-gray-700'
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
  const [followupOnly, setFollowupOnly] = useState(false);

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

  const followupCount = calls.filter((c) => c.needs_staff_followup).length;
  const visibleCalls = followupOnly ? calls.filter((c) => c.needs_staff_followup) : calls;
  const stats = computeStats(calls);
  const groups = groupCallsByDate(visibleCalls);

  return (
    <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <CallsPageHeader count={calls.length} />

      {loadError && (
        <div className="mb-6 px-4 py-3 text-sm rounded-[10px]" style={{ border: '1px solid var(--danger)', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <strong>Failed to load calls:</strong> {loadError}
        </div>
      )}

      {calls.length === 0 && !loadError ? (
        <div className="fd-card px-6 py-16 text-center">
          <p className="fd-display text-3xl mb-2" style={{ color: 'var(--ink)' }}>No calls yet</p>
          <p className="text-[15px]" style={{ color: 'var(--ink-soft)' }}>
            Calls handled by your front desk will appear here.
          </p>
        </div>
      ) : (
        <>
          <StatStrip stats={stats} />

          {/* Needs-follow-up filter — surfaces calls extraction flagged for staff action. */}
          {followupCount > 0 && (
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => setFollowupOnly(false)}
                className={`fd-pill ${followupOnly ? 'fd-pill-muted' : 'fd-pill-info'}`}
              >
                All calls
              </button>
              <button
                onClick={() => setFollowupOnly(true)}
                className={`fd-pill ${followupOnly ? 'fd-pill-warn' : 'fd-pill-muted'}`}
              >
                Needs follow-up · {followupCount}
              </button>
            </div>
          )}

          {visibleCalls.length === 0 ? (
            <div className="fd-card px-6 py-12 text-center">
              <p className="text-[15px]" style={{ color: 'var(--ink-soft)' }}>
                No calls need follow-up right now.
              </p>
            </div>
          ) : (
          <div className="space-y-10 fd-stagger">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-muted)' }}>
                    {group.label}
                  </h2>
                  <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {group.calls.length} call{group.calls.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.calls.map((call) => (
                    <CallRow
                      key={call.id}
                      call={call}
                      expanded={expandedId === call.id}
                      onToggle={() => toggleExpand(call.id)}
                      transcript={transcripts[call.id]}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export default function CallHistoryPage() {
  const { isDemo } = useDashboardMode();
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isDemo ? 'demo' : 'loading'
  );
  const [calls, setCalls] = useState<DbCall[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo || !isSupabaseConfigured) return;

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
  }, [isDemo]);

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
