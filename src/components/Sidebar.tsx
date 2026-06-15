'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MOCK_RESTAURANT, MOCK_RESERVATIONS, MOCK_ORDERS } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { demoHref } from '@/lib/dashboard-mode';

const DEMO_APPT_COUNT = MOCK_RESERVATIONS.filter((r) => r.status === 'pending').length;
const DEMO_ORDER_COUNT = MOCK_ORDERS.filter((o) => o.status === 'pending').length;

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Overview',
    demoCount: null as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/voice',
    label: 'Test the call',
    demoCount: null as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/calls',
    label: 'Call history',
    demoCount: null as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/reservations',
    label: 'Reservations',
    demoCount: DEMO_APPT_COUNT as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/dashboard/orders',
    label: 'Service requests',
    demoCount: DEMO_ORDER_COUNT as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/dashboard/knowledge',
    label: 'Knowledge base',
    demoCount: null as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    demoCount: null as number | null,
    icon: (
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  auto_repair: 'Auto repair',
  salon: 'Salon & spa',
  clinic: 'Clinic',
  tutoring: 'Tutoring center',
  home_services: 'Home services',
  other: 'Service business',
};

export default function Sidebar({
  businessName,
  businessType,
  forceDemo = false,
  isSignedIn = false,
  variant = 'default',
  onNavigate,
  onClose,
}: {
  businessName?: string;
  businessType?: string;
  forceDemo?: boolean;
  isSignedIn?: boolean;
  variant?: 'default' | 'drawer';
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    router.push('/');
    router.refresh();
  }

  // Demo vs real is resolved server-side and passed in via props — never derive it from the
  // client-only `userEmail`, which starts null and would flash demo identity on a real dashboard.
  const isDemo = forceDemo || !isSignedIn;
  // Real mode must never display the demo restaurant's name — neutral fallback if the fetch failed.
  const displayName = isDemo ? MOCK_RESTAURANT.name : (businessName ?? 'Your business');

  return (
    <aside className="fd-sidebar w-60 h-full flex flex-col flex-shrink-0">

      {/* ── Wordmark ───────────────────────────────────────────────────── */}
      <div className="h-14 px-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--sidebar-line)' }}>
        <Link href="/" onClick={onNavigate} className="flex items-baseline gap-2 group">
          <span
            className="text-[13px] font-bold tracking-[0.32em] uppercase"
            style={{ color: 'var(--sidebar-strong)' }}
          >
            FrontDesk
          </span>
          <span
            className="fd-display text-[16px]"
            style={{ color: 'var(--accent)' }}
          >
            ·
          </span>
        </Link>
        {variant === 'drawer' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="flex items-center justify-center w-11 h-11 -mr-2 rounded-[8px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Section label ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-2">
        <span className="fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>
          Workspace
        </span>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 space-y-px overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
          const badge = isDemo && item.demoCount ? item.demoCount : null;
          // Restaurants (and the mock-restaurant demo) say "Reservations"; other verticals
          // say "Appointments". Route stays /dashboard/reservations either way.
          const label =
            item.href === '/dashboard/reservations' && !isDemo && businessType !== 'restaurant'
              ? 'Appointments'
              : item.label;

          return (
            <Link
              key={item.href}
              href={demoHref(item.href, isDemo)}
              onClick={onNavigate}
              className={`group flex items-center gap-3 px-3 py-2 rounded-[4px] text-[13px] transition-colors ${
                isActive ? 'fd-sidebar-active font-semibold' : 'hover:bg-white/[0.04]'
              }`}
              style={{ color: isActive ? 'var(--sidebar-strong)' : undefined }}
            >
              <span
                className="flex-shrink-0 transition-colors"
                style={{ color: isActive ? 'var(--accent)' : 'var(--ink-muted)' }}
              >
                {item.icon}
              </span>
              <span className="flex-1 min-w-0 truncate">{label}</span>
              {badge != null && badge > 0 && (
                <span
                  className="flex-shrink-0 fd-numeric text-[10px] font-semibold w-5 h-5 flex items-center justify-center rounded-full leading-none"
                  style={{ backgroundColor: 'rgba(208, 79, 26, 0.18)', color: 'var(--accent)' }}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom business card ────────────────────────────────────────── */}
      <div className="p-3" style={{ borderTop: '1px solid var(--sidebar-line)' }}>
        <div
          className="rounded-[5px] p-3.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--sidebar-line)' }}
        >
          {/* No "Live" claim — there is no live phone line yet; this is just the workspace card. */}
          <div className="flex items-center gap-1.5 mb-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
            <span className="fd-eyebrow" style={{ color: 'var(--ink-muted)', fontSize: '9px', letterSpacing: '0.22em' }}>
              Workspace
            </span>
          </div>
          <p className="text-[13px] font-semibold truncate leading-snug" style={{ color: 'var(--sidebar-strong)' }}>
            {displayName}
          </p>
          {isDemo ? (
            <>
              <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                {BUSINESS_TYPE_LABELS[MOCK_RESTAURANT.businessType] ?? 'Service business'}
              </p>
              <div className="mt-3 flex items-center gap-3 text-[11px]">
                <Link href="/" className="hover:text-white transition-colors" style={{ color: 'var(--ink-muted)' }}>
                  ← Home
                </Link>
                {isSignedIn ? (
                  <a href="/dashboard" className="hover:text-white transition-colors" style={{ color: 'var(--ink-muted)' }}>
                    My dashboard →
                  </a>
                ) : (
                  <Link href="/login" className="hover:text-white transition-colors" style={{ color: 'var(--ink-muted)' }}>
                    Sign in →
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>{userEmail}</p>
              <div className="mt-3 flex items-center gap-3 text-[11px]">
                <Link href="/" className="hover:text-white transition-colors" style={{ color: 'var(--ink-muted)' }}>
                  ← Home
                </Link>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1 hover:text-white transition-colors"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Sign out →
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </aside>
  );
}
