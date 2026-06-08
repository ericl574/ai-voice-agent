'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import DemoBanner from '@/components/DemoBanner';

// Responsive dashboard chrome: a persistent sidebar at lg+ and a hamburger + slide-in drawer below
// 1024px (phones + iPad portrait). Server layout passes the resolved business/demo flags in.
export default function DashboardShell({
  businessName,
  forceDemo,
  isSignedIn,
  showDemoBanner,
  children,
}: {
  businessName?: string;
  forceDemo: boolean;
  isSignedIn: boolean;
  showDemoBanner: boolean;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  function closeNav() {
    setNavOpen(false);
    hamburgerRef.current?.focus(); // restore focus to the trigger
  }

  // Close the drawer on navigation.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // While the drawer is open: lock background scroll, close on Escape, and move focus into it.
  useEffect(() => {
    if (!navOpen) return;
    drawerRef.current?.focus();
    // Safe body scroll lock with restore (belt-and-suspenders alongside the inner overflow toggle).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNav(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--paper)' }}>
      {/* Persistent sidebar — desktop / laptop / iPad landscape */}
      <div className="hidden lg:block h-full flex-shrink-0">
        <Sidebar businessName={businessName} forceDemo={forceDemo} isSignedIn={isSignedIn} />
      </div>

      {/* Mobile drawer (<1024px) */}
      {navOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40"
            style={{ backgroundColor: 'rgba(29,29,31,0.42)' }}
            onClick={closeNav}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 h-full shadow-2xl outline-none"
          >
            <Sidebar
              businessName={businessName}
              forceDemo={forceDemo}
              isSignedIn={isSignedIn}
              variant="drawer"
              onNavigate={closeNav}
              onClose={closeNav}
            />
          </div>
        </div>
      )}

      {/* Background scroll is locked (overflow-hidden) while the drawer is open. */}
      <div className={`flex-1 flex flex-col min-w-0 ${navOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {/* Mobile top bar with hamburger */}
        <div
          className="lg:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 flex-shrink-0"
          style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--hairline)' }}
        >
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={navOpen}
            className="flex items-center justify-center -ml-1 w-11 h-11 rounded-[8px]"
            style={{ color: 'var(--ink)' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-[13px] font-bold tracking-[0.28em] uppercase" style={{ color: 'var(--ink)' }}>
            FrontDesk
          </span>
        </div>

        {showDemoBanner && <DemoBanner isSignedIn={isSignedIn} />}
        <main className="flex-1 fd-canvas min-w-0">{children}</main>
      </div>
    </div>
  );
}
