'use client';

import { useState } from 'react';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/agents/verticals/registry';

// "Start a pilot" signup form on /contact. Posts to /api/pilot-request, which captures the lead
// server-side and best-effort emails the support inbox. No account required.

const INPUT =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400';

type Status = 'idle' | 'sending' | 'done' | 'error';

export default function PilotRequestForm() {
  const [form, setForm] = useState({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    businessType: 'other',
    city: '',
    message: '',
  });
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/pilot-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please try again.');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch {
      setError('Something went wrong — please try again.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <p className="font-semibold text-green-800">Thanks — we got it.</p>
        <p className="text-sm text-green-700 mt-1">
          We&apos;ll reach out shortly to set up your pilot. If it&apos;s urgent, email us directly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 border border-gray-100 rounded-xl p-5"
    >
      <Field label="Business name" required>
        <input
          className={INPUT}
          required
          value={form.businessName}
          onChange={(e) => set('businessName', e.target.value)}
          placeholder="e.g. Sunrise Auto Repair"
        />
      </Field>
      <Field label="Your name" required>
        <input
          className={INPUT}
          required
          value={form.contactName}
          onChange={(e) => set('contactName', e.target.value)}
          placeholder="Owner / manager"
        />
      </Field>
      <Field label="Email" required>
        <input
          type="email"
          className={INPUT}
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="you@yourbusiness.com"
        />
      </Field>
      <Field label="Phone">
        <input
          type="tel"
          className={INPUT}
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="(555) 867-5309"
        />
      </Field>
      <Field label="Business type">
        <select
          className={INPUT}
          value={form.businessType}
          onChange={(e) => set('businessType', e.target.value)}
        >
          {BUSINESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="City">
        <input
          className={INPUT}
          value={form.city}
          onChange={(e) => set('city', e.target.value)}
          placeholder="Springfield"
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Anything we should know?">
          <textarea
            rows={3}
            className={`${INPUT} resize-none`}
            value={form.message}
            onChange={(e) => set('message', e.target.value)}
            placeholder="When do you miss the most calls? What kind of calls are they?"
          />
        </Field>
      </div>

      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          {status === 'sending' ? 'Sending…' : 'Start a pilot'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
