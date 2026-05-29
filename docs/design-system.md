# FrontDesk AI — Design System

The dashboard uses an Apple-inspired "Studio Modernist" look: neutral system grays, SF
system fonts, hairline borders, soft radii, one warm accent. All tokens and primitives live
in `src/app/globals.css` and are consumed via plain class names + CSS variables — no UI
library, Tailwind v4 only.

> When building or restyling any dashboard surface, reuse these primitives. Do not reintroduce
> raw `bg-white rounded-xl shadow-sm border-gray-100` patterns or ad-hoc color hexes.

## Fonts (Apple system stack)

Defined as CSS variables and exposed to Tailwind via `@theme`:

- `--font-display` / `--font-body` → `-apple-system, BlinkMacSystemFont, "SF Pro Display",
  "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, system-ui, sans-serif`
- `--font-mono` → `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code",
  Consolas, monospace`

On Apple platforms this renders San Francisco; elsewhere it falls back to the native system
font. There are **no** Google Font `@import`s — keep it that way.

## Color tokens (`:root` in globals.css)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F5F5F7` | page background (Apple light gray) |
| `--paper-dim` | `#ECECEE` | secondary fill / quiet button hover |
| `--surface` | `#FFFFFF` | cards |
| `--surface-soft` | `#FAFAFC` | nested cards, metadata bands |
| `--ink` | `#1D1D1F` | primary text, dark buttons |
| `--ink-2` | `#2C2C2E` | high-contrast body |
| `--ink-soft` | `#6E6E73` | secondary text |
| `--ink-muted` | `#86868B` | tertiary text, captions, eyebrows |
| `--ink-faint` | `#AEAEB2` | placeholders, em-dashes |
| `--hairline` | `#E5E5EA` | default borders/dividers |
| `--hairline-strong` | `#D2D2D7` | emphasized borders, input outline |
| `--accent` / `--accent-hot` / `--accent-soft` | `#D04F1A` / `#A33D11` / `#FBEDE2` | brand orange; hover; tint bg |
| `--ok` / `--ok-soft` | `#2E7D5B` / `#E6F0EA` | confirmed, resolved |
| `--warn` / `--warn-soft` | `#B26B12` / `#FAEDD0` | pending |
| `--danger` / `--danger-soft` | `#9F2D34` / `#F6E1E3` | declined, escalated, errors |
| `--info` / `--info-soft` | `#2A5B8B` / `#E4EDF6` | appointment / service-request type chips |
| `--focus-ring` | `rgba(0,122,255,0.35)` | input focus glow (Apple blue) |
| `--sidebar-bg / -line / -text / -strong` | `#1D1D1F` / `rgba(255,255,255,.08)` / `#AEAEB2` / `#FFF` | dark sidebar |

## Primitive classes

- **`fd-card`** — white surface, `1px var(--hairline)` border, 14px radius, no shadow.
  `fd-card-inset` (soft bg, 12px) and `fd-card-flat` (top/bottom hairlines only) are variants.
- **`fd-btn`** + variants — `fd-btn-primary` (ink fill → accent on hover), `fd-btn-accent`
  (accent fill), `fd-btn-ghost` (hairline outline), `fd-btn-quiet` (text-only). 10px radius,
  subtle `scale(0.98)` press.
- **`fd-pill`** — small caps status chip. Status variants: `fd-pill-ok`, `fd-pill-warn`,
  `fd-pill-danger`, `fd-pill-info`, `fd-pill-muted`. `StatusBadge.tsx` maps statuses to these.
- **`fd-eyebrow`** — 10px uppercase tracked label (section kickers, column headers).
- **`fd-display`** — large headings: SF semibold, tight `-0.022em` tracking (no serif/italic).
- **`fd-section-title`** / **`fd-section-header`** — uppercase section title + bottom rule.
- **`fd-tab`** / **`fd-tab-active`** — pill filter tabs (All / Pending / Confirmed / Declined).
- **`fd-input`** — 10px radius, hairline border, Apple-blue focus ring.
- **`fd-numeric`** — monospaced tabular figures for times, durations, phone numbers.
- **`fd-stagger`** — wraps a list to fade children in on load (`fd-rise` keyframe, respects
  `prefers-reduced-motion`).
- **`fd-sidebar`** / **`fd-sidebar-active`** / **`fd-canvas`** — dark sidebar + page canvas.

## Conventions

- **Cards over tables** for queues. Appointments and Service Requests use full-width cards
  (`src/app/dashboard/reservations/page.tsx`, `.../orders/page.tsx`); Call History uses
  date-grouped cards with a stat strip (`.../calls/page.tsx`). Avoid cramped multi-column
  tables with wrapping cells.
- **Avatars** — `avatarFor(name)` returns a deterministic soft-tinted `{bg, fg}` from a fixed
  8-color palette (Apple Contacts style). Currently duplicated in `calls`, `orders`, and
  `reservations` pages — **candidate for extraction to a shared helper** (e.g.
  `src/lib/avatar.ts`); not yet done to keep recent diffs surgical.
- **Copy** — customer-facing UI says **"Front desk"**, never "AI assistant" (also a CLAUDE.md
  product rule).
- **Transcript alignment** — Front desk bubbles left, Caller bubbles right (staff-review
  perspective), in `TranscriptPanel` (`.../calls/page.tsx`).
- **No heavy shadows, no large radii.** Hairline borders + soft 10–14px radii carry the
  hierarchy. One accent color, used sparingly.

## Redesign status (as of working tree)

- Done: Overview, Call History, Appointments, Service Requests, Voice test page, shared chrome
  (`Sidebar`, `DemoBanner`, `StatusBadge`), `globals.css`.
- Partial: Knowledge / Settings / Simulator — card/button/hairline chrome swapped via the
  primitives, but their page headers haven't been brought to the `fd-display` treatment yet.
- Not started: landing `/`, auth (`/login`, `/signup`, `/onboarding`). The landing page's
  `HeroVideoPlaylist` video loop must be left intact.
