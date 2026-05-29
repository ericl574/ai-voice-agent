# Catch-up — session handoff

> **For a fresh Claude session.** Point-in-time snapshot of where this project is right now so
> you can continue with minimal effort. **Overwrite this whole file** at the next catch-up — it
> is not a log. Durable facts live elsewhere; this file links to them:
> `CLAUDE.md` · `docs/design-system.md` · `docs/call-pipeline.md` · `docs/ai-collaboration-workflow.md`.

**Snapshot date:** 2026-05-28

## Repo state
- HEAD = `36ac395` (pre-redesign baseline).
- A large body of work is **uncommitted** in the working tree: the Apple UI redesign, the
  call-pipeline fixes, the `CLAUDE.md` refresh, and the new `docs/`.
- Nothing is committed. **Commit only when Eric explicitly asks.**

## Done this session
- **Design system** — Apple "Studio Modernist" look in `src/app/globals.css`: SF system fonts,
  neutral gray palette, `fd-*` primitives (`fd-card`, `fd-btn*`, `fd-pill*`, `fd-eyebrow`,
  `fd-display`, `fd-tab*`, `fd-input`, `fd-stagger`). Conventions → `docs/design-system.md`.
- **Pages redesigned** — Overview, Call History (date-grouped cards + tinted avatars + stat
  strip), Appointments (full-width cards), Service Requests (full-width cards), Voice test page;
  shared chrome (`Sidebar`, `DemoBanner`, `StatusBadge`).
- **Call pipeline** — conservative server VAD + per-turn caller transcription; both caller and
  Front desk turns saved as separate `call_messages` rows; assistant capture via
  `conversation.item.added`; transcript renders Front desk left / Caller right. Architecture →
  `docs/call-pipeline.md`.
- **Docs** — `CLAUDE.md` refreshed; `docs/design-system.md` + `docs/call-pipeline.md` created.

## In progress / not finished
- **Knowledge / Settings / Simulator** — primitives applied (cards/buttons/hairlines) but page
  **headers not yet** moved to the `fd-display` treatment.
- **Landing `/` + auth** (`/login`, `/signup`, `/onboarding`) — **not redesigned**. Leave the
  landing `HeroVideoPlaylist` video loop intact.

## Open items / gotchas (verify against a LIVE call)
- Assistant-capture + VAD tuning are **principled but unverified live.** Next test must confirm:
  (1) both sides appear in Call History, (2) multiple separate Caller turns (not one blob),
  (3) noise/silence does NOT trigger repeated Front desk replies.
- VAD knobs live in **one place** — `src/app/api/voice-session/route.ts`
  (`threshold 0.65`, `silence_duration_ms 1000`). Adjust there if still too sensitive/insensitive.
- If assistant turns are still missing, the `[FD debug]` console logs in
  `src/app/dashboard/voice/page.tsx` print every Realtime event type — use them to see what the
  model actually emits.
- `avatarFor()` is duplicated in the `calls` / `orders` / `reservations` pages — candidate for a
  shared helper (e.g. `src/lib/avatar.ts`); deferred to keep diffs surgical.

## Working rules to honor
- Don't commit unless Eric asks. Before any approved commit: `npm run build` +
  `npm run qa:call-pipeline` must pass.
- Surgical changes only — don't redesign unrequested surfaces; don't switch transcription
  models; phone stays optional; appointments default **pending**; appointment-only ≠ service
  request; customer-facing copy says **"Front desk"** (never "AI assistant").
- Eric frequently drives via the `karpathy-guidelines`, `code-review`, and `frontend-design`
  skills — expect tight, scoped requests and explain root cause before editing.

## Suggested next steps
1. Live-verify the call pipeline (the most important open thing).
2. Finish remaining redesigns: knowledge/settings/simulator headers → landing → auth.
3. Commit the working tree once Eric approves.
