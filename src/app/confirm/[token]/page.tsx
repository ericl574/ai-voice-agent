'use client';

// Public (unauthenticated) reservation confirmation page reached from the SMS link.
// The caller reviews their reservation and adds a card on file to confirm it.
//
// PLACEHOLDER payment: no real card processor is wired up. The card fields are visual only and are
// NEVER transmitted or stored — confirming simply flips the reservation to 'confirmed' via the
// scoped `confirm_reservation` RPC. Real Stripe (SetupIntent) drops in here later.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

interface Reservation {
  customer_name: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  party_size: number | null;
  service_type: string | null;
  status: string;
  expires_at: string | null;
  business_name: string | null;
}

type Phase = 'loading' | 'awaiting' | 'confirmed' | 'expired' | 'invalid' | 'error';

const DEMO_RESERVATION: Reservation = {
  customer_name: 'Guest',
  appointment_date: 'Saturday',
  appointment_time: '7:30 PM',
  party_size: 2,
  service_type: 'Dinner reservation',
  status: 'awaiting_customer',
  expires_at: null,
  business_name: 'Demo Restaurant',
};

function isExpired(r: Reservation): boolean {
  return (
    r.status === 'expired' ||
    (r.status === 'awaiting_customer' && !!r.expires_at && new Date(r.expires_at).getTime() < Date.now())
  );
}

export default function ConfirmReservationPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [phase, setPhase] = useState<Phase>('loading');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }

    if (!isSupabaseConfigured) {
      // Demo: no DB — show a sample reservation so the flow is viewable.
      setReservation(DEMO_RESERVATION);
      setPhase('awaiting');
      return;
    }

    async function load() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc('get_reservation_for_confirmation', { p_token: token });
        if (error) { setErrorMsg(error.message); setPhase('error'); return; }
        const row = (Array.isArray(data) ? data[0] : data) as Reservation | undefined;
        if (!row) { setPhase('invalid'); return; }
        setReservation(row);
        if (row.status === 'confirmed') setPhase('confirmed');
        else if (isExpired(row)) setPhase('expired');
        else if (row.status === 'awaiting_customer') setPhase('awaiting');
        else setPhase('invalid');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }
    load();
  }, [token]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    try {
      if (!isSupabaseConfigured) {
        // Demo: simulate success without touching a DB.
        setPhase('confirmed');
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase.rpc('confirm_reservation', { p_token: token });
      if (error) { setErrorMsg(error.message); setPhase('error'); return; }
      const result = String(data);
      if (result === 'confirmed' || result === 'already_confirmed') setPhase('confirmed');
      else if (result === 'expired') setPhase('expired');
      else setPhase('invalid');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--paper)' }}
    >
      <div className="fd-card w-full max-w-md overflow-hidden">
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}>
          <p className="fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>
            {reservation?.business_name ?? 'Reservation'}
          </p>
          <h1 className="fd-display text-2xl" style={{ color: 'var(--ink)' }}>Confirm your reservation</h1>
        </div>

        <div className="px-6 py-6">
          {phase === 'loading' && (
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>Loading…</p>
          )}

          {(phase === 'awaiting') && reservation && (
            <>
              <ReservationSummary r={reservation} />
              <form onSubmit={handleConfirm} className="mt-5 space-y-3">
                <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
                  Add a card to hold your reservation. You won’t be charged now.
                </p>
                <input className="fd-input w-full" placeholder="Card number" inputMode="numeric" autoComplete="off" />
                <div className="grid grid-cols-2 gap-3">
                  <input className="fd-input w-full" placeholder="MM / YY" autoComplete="off" />
                  <input className="fd-input w-full" placeholder="CVC" inputMode="numeric" autoComplete="off" />
                </div>
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Demo only — no real card is processed or stored.
                </p>
                {errorMsg && <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{errorMsg}</p>}
                <button type="submit" disabled={submitting} className="fd-btn fd-btn-accent w-full">
                  {submitting ? 'Confirming…' : 'Confirm reservation'}
                </button>
              </form>
            </>
          )}

          {phase === 'confirmed' && (
            <Result
              title="Reservation confirmed"
              tone="ok"
              message="Thanks! Your reservation is confirmed and your card is on file. We look forward to seeing you."
            >
              {reservation && <ReservationSummary r={reservation} className="mt-4" />}
            </Result>
          )}

          {phase === 'expired' && (
            <Result
              title="This link has expired"
              tone="warn"
              message="The confirmation window has passed and this reservation was released. Please call the business to rebook."
            />
          )}

          {phase === 'invalid' && (
            <Result
              title="Reservation not found"
              tone="muted"
              message="This confirmation link is invalid or has already been handled. If you think this is a mistake, please call the business."
            />
          )}

          {phase === 'error' && (
            <Result title="Something went wrong" tone="warn" message={errorMsg || 'Please try again, or call the business to confirm.'} />
          )}
        </div>
      </div>
    </main>
  );
}

function ReservationSummary({ r, className = '' }: { r: Reservation; className?: string }) {
  const when = [r.appointment_date, r.appointment_time].filter(Boolean).join(' · ');
  return (
    <div className={`rounded-[10px] px-4 py-3 ${className}`} style={{ backgroundColor: 'var(--surface-soft)', border: '1px solid var(--hairline)' }}>
      {r.customer_name && (
        <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{r.customer_name}</p>
      )}
      {when && <p className="text-[13px] mt-0.5 fd-numeric" style={{ color: 'var(--ink-2)' }}>{when}</p>}
      {(r.party_size || r.service_type) && (
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
          {r.party_size ? `${r.party_size} guest${r.party_size !== 1 ? 's' : ''}` : r.service_type}
        </p>
      )}
    </div>
  );
}

function Result({
  title,
  message,
  tone,
  children,
}: {
  title: string;
  message: string;
  tone: 'ok' | 'warn' | 'muted';
  children?: React.ReactNode;
}) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-muted)';
  return (
    <div>
      <p className="fd-display text-xl" style={{ color }}>{title}</p>
      <p className="text-[14px] mt-2 leading-relaxed" style={{ color: 'var(--ink-soft)' }}>{message}</p>
      {children}
    </div>
  );
}
