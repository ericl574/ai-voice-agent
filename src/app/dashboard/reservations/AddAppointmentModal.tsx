'use client';

import { useState } from 'react';

export interface NewAppointmentInput {
  customer_name: string;
  appointment_date: string; // YYYY-MM-DD
  appointment_time: string; // HH:MM
  status: 'pending' | 'confirmed';
  customer_phone: string;
  service_type: string;
  special_request: string;
}

// Manual appointment entry. Name + date + time are required so the new row always lands on the
// grid; everything else is optional. The parent owns persistence (real insert / demo append).
export default function AddAppointmentModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewAppointmentInput) => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit = name.trim() && date && time && !submitting;

  function reset() {
    setName(''); setDate(''); setTime(''); setStatus('pending');
    setPhone(''); setService(''); setNotes(''); setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        customer_name: name.trim(),
        appointment_date: date,
        appointment_time: time,
        status,
        customer_phone: phone.trim(),
        service_type: service.trim(),
        special_request: notes.trim(),
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(29,29,31,0.42)' }}
      onClick={onClose}
    >
      <div
        className="fd-card w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-4"
          style={{ borderBottom: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}
        >
          <p className="fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>Schedule</p>
          <h2 className="fd-display text-2xl" style={{ color: 'var(--ink)' }}>Add appointment</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Field label="Name" required>
            <input
              className="fd-input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Date" required>
              <input type="date" className="fd-input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time" required>
              <input type="time" className="fd-input w-full" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>

          <Field label="Status">
            <div className="flex gap-1.5">
              {(['pending', 'confirmed'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`fd-tab ${status === s ? 'fd-tab-active' : ''}`}
                >
                  {s === 'pending' ? 'Pending' : 'Confirmed'}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Phone">
            <input className="fd-input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Service / reason">
            <input className="fd-input w-full" value={service} onChange={(e) => setService(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Notes">
            <textarea className="fd-input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>

          {error && (
            <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p>
          )}
        </div>

        <div
          className="px-6 py-4 flex justify-end gap-2"
          style={{ borderTop: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}
        >
          <button className="fd-btn fd-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="fd-btn fd-btn-accent" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Adding…' : 'Add appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="fd-eyebrow block mb-1.5" style={{ color: 'var(--ink-muted)' }}>
        {label}{required && <span style={{ color: 'var(--accent)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}
