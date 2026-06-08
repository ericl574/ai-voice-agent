'use client';

import { createContext, useContext } from 'react';

// Demo vs real is resolved **once on the server** (dashboard/layout.tsx reads the `x-demo-mode`
// header that proxy.ts sets from `?demo=1`) and handed to the whole dashboard subtree through this
// context. Pages must read demo state from here — never re-derive it from client-only async state
// (which caused mixed-mode: sidebar demo, main content real). Because every in-dashboard nav link
// preserves `?demo=1` (see `demoHref`) and exits are full page loads, this server-resolved value
// stays consistent for the whole session.
export interface DashboardMode {
  isDemo: boolean;
  isSignedIn: boolean;
  businessName?: string;
}

const DashboardModeContext = createContext<DashboardMode>({
  isDemo: false,
  isSignedIn: false,
});

export function DashboardModeProvider({
  value,
  children,
}: {
  value: DashboardMode;
  children: React.ReactNode;
}) {
  return (
    <DashboardModeContext.Provider value={value}>{children}</DashboardModeContext.Provider>
  );
}

export function useDashboardMode(): DashboardMode {
  return useContext(DashboardModeContext);
}

// Appends `demo=1` to a dashboard href when demo mode is active, so client navigation never drops
// the param and desyncs the sidebar from the page. Pass-through (unchanged) when not in demo.
export function demoHref(href: string, isDemo: boolean): string {
  if (!isDemo) return href;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('demo', '1');
  return `${path}?${params.toString()}`;
}
