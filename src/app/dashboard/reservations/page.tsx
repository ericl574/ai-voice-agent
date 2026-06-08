'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness, type AgentConfig } from '@/lib/supabase/businesses';
import { useDashboardMode } from '@/lib/dashboard-mode';
import { todayInTimeZone } from '@/lib/call-pipeline/time';
import { MOCK_RESERVATIONS, RequestStatus } from '@/lib/mock-data';
import {
  type DbAppointment,
  mockToAppointments,
  parseApptDateTime,
  effectiveStatus,
  startOfWeek,
  addDays,
} from '@/lib/appointments';
import WeekGrid from './WeekGrid';
import MonthHeatmap from './MonthHeatmap';
import ScheduleList from './ScheduleList';
import AddAppointmentModal, { type NewAppointmentInput } from './AddAppointmentModal';

type View = 'week' | 'month';

function dateFromYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function ReservationsPage() {
  const { isDemo } = useDashboardMode();
  const [loading, setLoading] = useState(!isDemo);
  const [demo, setDemo] = useState(isDemo);
  const [businessId, setBusinessId] = useState('');
  const [today, setToday] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<DbAppointment[]>(
    isDemo ? mockToAppointments(MOCK_RESERVATIONS) : [],
  );

  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [anchorInitialized, setAnchorInitialized] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reservation confirmation mode lives here now (persisted in agent_config).
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({});
  const mode: 'staff' | 'auto' = agentConfig.reservation_confirmation_mode === 'auto' ? 'auto' : 'staff';
  const windowHours = agentConfig.confirmation_window_hours ?? 24;

  // Load real appointments (or fall back to demo).
  useEffect(() => {
    if (isDemo || !isSupabaseConfigured) return;
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const business = session ? await getActiveBusiness(supabase) : null;
      if (!business) {
        setDemo(true);
        setAppointments(mockToAppointments(MOCK_RESERVATIONS));
        setLoading(false);
        return;
      }
      setBusinessId(business.id);
      setAgentConfig((business.agent_config as AgentConfig | null) ?? {});
      setToday(dateFromYMD(todayInTimeZone(business.timezone)));
      const { data, error: loadErr } = await supabase
        .from('appointments')
        .select('*')
        .eq('business_id', business.id)
        .order('appointment_date', { ascending: true });
      if (loadErr) setError(loadErr.message);
      else setAppointments((data as DbAppointment[]) ?? []);
      setLoading(false);
    }
    load();
  }, [isDemo]);

  // Active = pending + confirmed + awaiting_customer (declined/expired excluded). effectiveStatus
  // turns an awaiting reservation past its window into 'expired', so it drops off automatically.
  const active = useMemo(
    () => appointments.filter((a) => {
      const s = effectiveStatus(a);
      return s === 'pending' || s === 'confirmed' || s === 'awaiting_customer';
    }),
    [appointments],
  );
  const dated = useMemo(
    () => active
      .filter((a) => parseApptDateTime(a) != null)
      .sort((a, b) => parseApptDateTime(a)!.getTime() - parseApptDateTime(b)!.getTime()),
    [active],
  );
  const undated = useMemo(() => active.filter((a) => parseApptDateTime(a) == null), [active]);

  // List order: nearest upcoming on top → furthest future, then past appointments at the bottom.
  // (`dated` stays ascending for the grid + anchor logic, which don't care about list order.)
  const listOrder = useMemo(() => {
    const todayMs = today.getTime();
    const upcoming = dated.filter((a) => parseApptDateTime(a)!.getTime() >= todayMs);
    const past = dated.filter((a) => parseApptDateTime(a)!.getTime() < todayMs);
    return [...upcoming, ...past];
  }, [dated, today]);

  // On first load, anchor the week to the NEAREST upcoming appointment (so the view opens near
  // today, not weeks out). If everything is in the past, fall back to the most recent one so the
  // view isn't empty. (`dated` is sorted ascending by datetime.)
  useEffect(() => {
    if (loading || anchorInitialized) return;
    if (dated.length > 0) {
      const todayMs = today.getTime();
      const upcoming = dated.find((a) => parseApptDateTime(a)!.getTime() >= todayMs);
      const target = upcoming ?? dated[dated.length - 1];
      setAnchor(startOfWeek(parseApptDateTime(target)!));
    }
    setAnchorInitialized(true);
  }, [loading, anchorInitialized, dated, today]);

  async function updateStatus(id: string, newStatus: RequestStatus) {
    const prev = appointments.find((a) => a.id === id)?.status;
    setAppointments((list) => list.map((a) => (a.id === id ? { ...a, status: newStatus } : a)));
    if (demo) return;
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from('appointments')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('business_id', businessId);
    if (updErr) {
      setError(`Failed to update status: ${updErr.message}`);
      setAppointments((list) => list.map((a) => (a.id === id ? { ...a, status: prev ?? a.status } : a)));
    }
  }

  // Persist a change to the reservation confirmation mode/window. Re-fetches the row's CURRENT
  // agent_config first and merges only the two confirmation keys, so a config change made elsewhere
  // (Settings/voice) after this page loaded isn't clobbered by our stale snapshot.
  async function setConfirmation(next: Partial<AgentConfig>) {
    setAgentConfig((prev) => ({ ...prev, ...next })); // optimistic local update
    if (demo) return;
    const supabase = createClient();
    const { data: row, error: readErr } = await supabase
      .from('businesses')
      .select('agent_config')
      .eq('id', businessId)
      .single();
    if (readErr) { setError(`Failed to save confirmation setting: ${readErr.message}`); return; }
    const fresh = ((row?.agent_config as AgentConfig | null) ?? {});
    const merged = { ...fresh, ...next };
    const { error: cfgErr } = await supabase
      .from('businesses')
      .update({ agent_config: merged })
      .eq('id', businessId);
    if (cfgErr) { setError(`Failed to save confirmation setting: ${cfgErr.message}`); return; }
    setAgentConfig(merged); // sync local to the persisted truth
  }

  async function handleAdd(input: NewAppointmentInput) {
    setError(null);
    if (demo) {
      const row: DbAppointment = {
        id: `local-${Date.now()}`,
        business_id: 'demo',
        customer_name: input.customer_name,
        customer_phone: input.customer_phone || null,
        appointment_date: input.appointment_date,
        appointment_time: input.appointment_time,
        service_type: input.service_type || null,
        special_request: input.special_request || null,
        status: input.status,
        staff_notes: 'Added manually by staff',
        call_id: null,
        created_at: new Date().toISOString(),
      };
      setAppointments((list) => [...list, row]);
      focusOn(row);
      return;
    }
    const supabase = createClient();
    const { data, error: insErr } = await supabase
      .from('appointments')
      .insert({
        business_id: businessId,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone || null,
        appointment_date: input.appointment_date,
        appointment_time: input.appointment_time,
        service_type: input.service_type || null,
        special_request: input.special_request || null,
        status: input.status,
        staff_notes: 'Added manually by staff',
        call_id: null,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    const row = data as DbAppointment;
    setAppointments((list) => [...list, row]);
    focusOn(row);
  }

  // Jump the week view to an appointment and select it.
  function focusOn(a: DbAppointment) {
    const d = parseApptDateTime(a);
    if (d) {
      setView('week');
      setAnchor(startOfWeek(d));
    }
    setSelectedId(a.id);
  }

  // Selecting an appointment (from the grid OR the list) navigates the schedule to its date: switch
  // to Week view and anchor on that week. WeekGrid scrolls its block into view on selectedId change,
  // and ScheduleList scrolls its row into view — so the two panes stay in sync both ways.
  function handleSelect(id: string) {
    setSelectedId(id);
    const appt = appointments.find((a) => a.id === id);
    const d = appt ? parseApptDateTime(appt) : null;
    if (d) {
      setView('week');
      setAnchor(startOfWeek(d));
    }
  }

  const weekLabel = useMemo(() => {
    const end = addDays(anchor, 6);
    const sameMonth = anchor.getMonth() === end.getMonth();
    const a = anchor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const b = end.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `${a} – ${b}`;
  }, [anchor]);

  const monthLabel = anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function shift(dir: -1 | 1) {
    setAnchor((cur) => addDays(cur, view === 'week' ? dir * 7 : dir * 30));
  }
  function goToday() {
    setAnchor(startOfWeek(today));
  }

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
        <div className="h-12 w-2/3 mb-8 animate-pulse" style={{ backgroundColor: 'var(--hairline)' }} />
        <div className="h-96 fd-card animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="fd-display text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Reservations
          </h1>
          <p className="text-[15px] max-w-2xl leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            Pending and confirmed appointments, laid out by time.
            {demo && <span style={{ color: 'var(--ink-muted)' }}> · demo</span>}
          </p>
        </div>
        <button className="fd-btn fd-btn-accent" onClick={() => setModalOpen(true)}>
          + Add appointment
        </button>
      </header>

      {/* Confirmation mode (moved here from Settings) + a mode-aware disclaimer. */}
      <div
        className="mb-6 rounded-[10px] overflow-hidden"
        style={{ border: '1px solid var(--hairline)' }}
      >
        <div
          className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2"
          style={{ backgroundColor: 'var(--surface-soft)', borderBottom: '1px solid var(--hairline)' }}
        >
          <span className="fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>Confirmation</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setConfirmation({ reservation_confirmation_mode: 'staff' })}
              className={`fd-tab ${mode === 'staff' ? 'fd-tab-active' : ''}`}
            >
              Staff confirms
            </button>
            <button
              onClick={() => setConfirmation({ reservation_confirmation_mode: 'auto' })}
              className={`fd-tab ${mode === 'auto' ? 'fd-tab-active' : ''}`}
            >
              Automatic (text + card)
            </button>
          </div>
          {mode === 'auto' && (
            <label className="flex items-center gap-2 text-[13px] ml-auto" style={{ color: 'var(--ink-soft)' }}>
              Window
              <input
                type="number"
                min={1}
                max={168}
                value={windowHours}
                onChange={(e) =>
                  setConfirmation({
                    confirmation_window_hours: Math.max(1, Math.min(168, Number(e.target.value) || 24)),
                  })
                }
                className="fd-input w-20"
              />
              hrs
            </label>
          )}
        </div>
        <div
          className="px-4 py-3 flex items-center gap-3"
          style={{ backgroundColor: 'var(--warn-soft)' }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--warn)' }}>
            {mode === 'auto' ? 'Auto-confirm' : 'Staff reminder'}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {mode === 'auto'
              ? 'Auto-confirm reservations show “Awaiting customer” with a confirmation link. Automatic texting isn’t live yet — use “Copy confirm link” on each awaiting reservation to send it. They become Confirmed once the customer confirms, and expire after the window.'
              : 'The front desk never confirms appointments directly. All requests stay pending until you confirm.'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 text-sm" style={{ border: '1px solid var(--danger)', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setView('week')} className={`fd-tab ${view === 'week' ? 'fd-tab-active' : ''}`}>Week</button>
          <button onClick={() => setView('month')} className={`fd-tab ${view === 'month' ? 'fd-tab-active' : ''}`}>Month</button>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          <button onClick={() => shift(-1)} className="fd-btn fd-btn-quiet" aria-label="Previous">‹</button>
          <button onClick={goToday} className="fd-btn fd-btn-quiet">Today</button>
          <button onClick={() => shift(1)} className="fd-btn fd-btn-quiet" aria-label="Next">›</button>
        </div>
        <span className="ml-auto fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>
          {view === 'week' ? weekLabel : monthLabel}
        </span>
      </div>

      {/* Schedule + list, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* The 7-day time grid needs width — hidden on phones (<md), where the agenda list below
            becomes the primary schedule. The month heatmap is text-based and shown at all sizes. */}
        <div className={view === 'week' ? 'hidden md:block' : ''}>
          {view === 'week' ? (
            <WeekGrid anchor={anchor} today={today} appointments={dated} selectedId={selectedId} onSelect={handleSelect} />
          ) : (
            <MonthHeatmap
              anchor={anchor}
              today={today}
              appointments={dated}
              onPickDay={(day) => { setAnchor(startOfWeek(day)); setView('week'); }}
            />
          )}
        </div>

        <ScheduleList
          dated={listOrder}
          undated={undated}
          selectedId={selectedId}
          onSelect={handleSelect}
          onConfirm={(id) => updateStatus(id, 'confirmed')}
          onDecline={(id) => updateStatus(id, 'declined')}
          onReopen={(id) => updateStatus(id, 'pending')}
        />
      </div>

      <AddAppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleAdd} />
    </div>
  );
}
