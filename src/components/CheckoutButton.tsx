'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Starts a Stripe Checkout for the given plan. Signed-out users are sent to signup first;
// when billing isn't configured on the deployment, shows a friendly note instead of crashing.
export default function CheckoutButton({
  plan,
  label,
  variant = 'primary',
}: {
  plan: 'starter' | 'pro';
  label: string;
  variant?: 'primary' | 'outline';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function startCheckout() {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        router.push('/signup');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(data.error ?? 'Checkout is unavailable right now — please try again.');
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setNote('Checkout is unavailable right now — please try again.');
    } catch {
      setNote('Checkout is unavailable right now — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={startCheckout}
        disabled={busy}
        className={
          variant === 'primary'
            ? 'w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors'
            : 'w-full border border-gray-300 hover:border-gray-400 disabled:opacity-60 bg-white text-gray-900 font-semibold px-6 py-3 rounded-lg text-sm transition-colors'
        }
      >
        {busy ? 'Starting checkout…' : label}
      </button>
      {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
