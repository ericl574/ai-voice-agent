'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { todayInTimeZone } from '@/lib/call-pipeline/time';
import { MOCK_RESERVATIONS, RequestStatus } from '@/lib/mock-data';
import {
  type DbAppointment,
  mockToAppointments,
  parseApptDateTime,
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
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [demo, setDemo] = useState(!isSupabaseConfigured);
  const [businessId, setBusinessId] = useState('');
  const [today, setToday] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<DbAppointment[]>(
    isSupabaseConfigured ? [] : mockToAppointments(MOCK_RESERVATIONS),
  );

  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [anchorInitialized, setAnchorInitialized] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load real appointments (or fall back to demo).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
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
  }, []);

  // Active = pending + confirmed (declined excluded from schedule + list).
  const active = useMemo(
    () => appointments.filter((a) => a.status === 'pending' || a.status === 'confirmed'),
    [appointments],
  );
  const dated = useMemo(
    () => active
      .filter((a) => parseApptDateTime(a) != null)
      .sort((a, b) => parseApptDateTime(a)!.getTime() - parseApptDateTime(b)!.getTime()),
    [active],
  );
  const undated = useMemo(() => active.filter((a) => parseApptDateTime(a) == null), [active]);

  // On first load, anchor the week to the most recent dated appointment so the view isn't empty.
  useEffect(() => {
    if (loading || anchorInitialized) return;
    if (dated.length > 0) {
      const latest = parseApptDateTime(dated[dated.length - 1])!;
      setAnchor(startOfWeek(latest));
    }
    setAnchorInitialized(true);
  }, [loading, anchorInitialized, dated]);

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

  function handleSelect(id: string) {
    setSelectedId(id);
    const appt = appointments.find((a) => a.id === id);
    const d = appt ? parseApptDateTime(appt) : null;
    if (d && view === 'week') setAnchor(startOfWeek(d));
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

      {/* Pending disclaimer — the front desk never confirms directly (CLAUDE.md rule 15). */}
      <div
        className="mb-6 px-4 py-3 flex items-center gap-3 rounded-[10px]"
        style={{ backgroundColor: 'var(--warn-soft)', border: '1px solid var(--warn)' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--warn)' }}>
          Staff reminder
        </span>
        <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
          The front desk never confirms appointments directly. All requests stay pending until you confirm.
        </span>
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
        <div>
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
          dated={dated}
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
