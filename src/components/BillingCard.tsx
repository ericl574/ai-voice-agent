'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useDashboardMode } from '@/lib/dashboard-mode';

interface BillingStatus {
  configured: boolean;
  subscription: {
    plan: string | null;
    status: string | null;
    currentPeriodEnd: string | null;
    hasCustomer: boolean;
  } | null;
}

const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro' };

function statusLabel(status: string | null): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  switch (status) {
    case 'active':
    case 'trialing':
      return { text: status === 'trialing' ? 'Trial' : 'Active', tone: 'ok' };
    case 'past_due':
    case 'unpaid':
      return { text: 'Payment issue', tone: 'warn' };
    case 'canceled':
      return { text: 'Canceled', tone: 'muted' };
    default:
      return { text: 'No plan', tone: 'muted' };
  }
}

// Settings → plan & billing. Reads /api/billing/status (RLS-scoped) and opens the Stripe
// customer portal. Degrades gracefully: demo mode, billing-not-configured, and no-plan states
// all render a friendly card instead of an error.
export default function BillingCard() {
  const { isDemo } = useDashboardMode();
  const [data, setData] = useState<BillingStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (isDemo) {
      setLoaded(true);
      return;
    }
    fetch('/api/billing/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, [isDemo]);

  async function openPortal() {
    setPortalBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      setNote(d.error ?? 'Could not open the billing portal.');
    } catch {
      setNote('Could not open the billing portal.');
    } finally {
      setPortalBusy(false);
    }
  }

  const sub = data?.subscription ?? null;
  const s = statusLabel(sub?.status ?? null);
  const toneColor = s.tone === 'ok' ? '#16a34a' : s.tone === 'warn' ? '#b45309' : 'var(--ink-muted)';

  return (
    <div className="fd-card overflow-hidden">
      <div className="px-5 py-4 border-b fd-hairline">
        <h2 className="font-semibold text-gray-900">Plan & Billing</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Your FrontDesk subscription — managed securely through Stripe.
        </p>
      </div>
      <div className="p-5">
        {isDemo ? (
          <p className="text-sm text-gray-500">
            Billing is not part of the demo. <Link href="/pricing" className="text-orange-600 hover:underline">See plans →</Link>
          </p>
        ) : !loaded ? (
          <div className="h-10 animate-pulse rounded" style={{ backgroundColor: 'var(--hairline)' }} />
        ) : data && !data.configured ? (
          <p className="text-sm text-gray-500">
            Billing isn&rsquo;t enabled on this deployment yet. Plans will appear here once it is.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {sub?.plan ? `${PLAN_LABEL[sub.plan] ?? sub.plan} plan` : 'No plan yet'}
                <span className="ml-2 text-xs font-medium" style={{ color: toneColor }}>
                  {s.text}
                </span>
              </p>
              {sub?.currentPeriodEnd && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Current period ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
            </div>
            {sub?.hasCustomer ? (
              <button
                onClick={openPortal}
                disabled={portalBusy}
                className="border border-gray-200 hover:border-gray-300 disabled:opacity-60 bg-white text-gray-700 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
            ) : (
              <Link
                href="/pricing"
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                View plans
              </Link>
            )}
          </div>
        )}
        {note && <p className="mt-3 text-xs text-amber-700">{note}</p>}
      </div>
    </div>
  );
}
