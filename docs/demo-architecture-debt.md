# Demo Architecture

> Updated 2026-06-07 after unifying demo mode behind a single source of truth (mixed-mode fix).

## Single source of truth (current design)

Demo vs real is resolved **once on the server** and shared with the entire dashboard subtree:

1. `proxy.ts` sets the `x-demo-mode` header when the URL has `?demo=1`.
2. `src/app/dashboard/layout.tsx` reads it → `forceDemo`, plus `isSignedIn` / `businessName`.
3. `DashboardShell` computes `isDemo = forceDemo || !isSignedIn` and provides
   `{ isDemo, isSignedIn, businessName }` via **`DashboardModeProvider`** (`src/lib/dashboard-mode.tsx`).
4. **Every** dashboard surface reads that one value with **`useDashboardMode()`** — Sidebar,
   Overview, Reservations, Calls, Orders, Knowledge, and the Voice test page. No page re-derives
   demo from client-only async state, and no page ignores `?demo=1` anymore.

**Why this is consistent across navigation:** the shared layout does not re-render on client-side
navigation, so its server-resolved value would go stale if a link dropped `?demo=1`. To prevent
that, every in-dashboard nav link routes through **`demoHref(href, isDemo)`**, which preserves
`?demo=1` while in demo. Exits (`Home`, `Sign in`, `My dashboard`, `Sign out`) intentionally drop
the param and trigger a full load, so the server re-resolves to real. Net effect: client
navigation never desyncs the sidebar from the page.

## Demo data & writes

- Each page seeds mock data (`MOCK_*`) when `isDemo`, and short-circuits its real Supabase fetch.
- Demo writes are local-only/no-ops (e.g. reservations `if (demo) return;`; demo "Refresh" is a
  fake timeout). The Voice page forces `canSave = false` in demo and shows "Calls are not saved in
  demo mode" — the live test call still runs (key stays server-side), it just isn't persisted.

## Remaining debt (optional next steps)

1. **Real-fetch boilerplate is still duplicated.** Each page keeps its own
   `loading/demo/real` machine + `getActiveBusiness` + query. Now that demo resolution is unified,
   the natural follow-up is a `useDashboardData()` hook that also centralizes the real fetch and
   `businessId`, so pages consume one shape. Not required for correctness.
2. **"Changes aren't saved" affordance could be more uniform.** `DemoBanner` shows in demo, but a
   shared inline notice on each write surface would make the "nothing persists" message consistent.

No rewrite was done in this batch — the change was making the existing server-resolved demo flag
the single source consumed everywhere, plus param-preserving links.
