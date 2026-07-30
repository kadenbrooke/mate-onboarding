# Mate Dashboard — Movable / Resizable Cards

**Date:** 2026-07-29
**App:** `projects/deployed/mate-onboarding` (mate.auto-mate.business)
**Surface:** `src/components/dash/DashboardView.tsx` (client dashboard at `/dash/[sessionId]`)

## Goal

Let a client rearrange their dashboard: drag to reorder and resize cards on
desktop, reorder on mobile. Custom layout persists per-device. A reset restores
the founder-designed default. Nothing about the default view changes until the
client chooses to customize.

## Decisions (locked with founder)

| Question | Answer |
|---|---|
| Behavior | Move **+** resize (desktop); reorder-only (mobile) |
| Entry | Edit-mode toggle, **off by default**, on both desktop + mobile |
| Persist | localStorage, per-device, keyed by sessionId |
| Audience | Clients → reset button + brand quality bar + graceful defaults required |
| Pinned | Hero + Ticker pinned at top; Calendar + all zone cards movable/resizable |
| Library | react-grid-layout 2.x primary; dnd-kit fallback; **decided by a React-19 smoke test** |

## Library gate (first implementation step)

React 19.2 removed `findDOMNode`. `react-grid-layout@2.2.4` (published 2026-07-29)
declares `peer react >= 16.3` and pulls `react-draggable@4.7.1` (which supports the
`nodeRef` escape hatch). Plausibly React-19-safe, not proven.

**Gate:** before building anything real, add RGL to the app, render two cards in a
throwaway route (`/dash/_rgltest`, deleted after), drag + resize both, watch the
console.
- **No `findDOMNode` / no throw** → proceed with Approach A (RGL).
- **Throws or warns hard** → switch to Approach B (dnd-kit + custom resize). All
  other design decisions below are identical either way; only the grid engine
  swaps.

## Approach A — react-grid-layout 2.x (primary)

- `ResponsiveGridLayout` (the WidthProvider-wrapped responsive variant) with two
  breakpoints: `lg` (desktop, 12 cols) and `xs` (mobile, 1 col).
- Edit mode maps to `isDraggable` / `isResizable` props (both `false` when off →
  fully static, normal scroll).
- `onLayoutChange(layout, allLayouts)` → debounced write to localStorage.
- Mobile breakpoint: `isResizable={false}` always (reorder-only per spec).

## Approach B — dnd-kit + custom resize (fallback)

- `@dnd-kit/core` + `@dnd-kit/sortable` for reorder (desktop and mobile).
- Fixed 12-col CSS grid; each card carries `{ colSpan, rowSpan }`.
- Resize = a south-east corner handle (edit mode only) with pointer events that
  snap `colSpan` (1–12) and `rowSpan` to the nearest grid track.
- Same localStorage shape and edit-mode gating as A.

## Components

- **`useDashLayout(sessionId, defaultLayout)`** — layout state hook.
  - SSR-safe: returns `defaultLayout` on first render; reads localStorage in a
    `useEffect` after mount (mirrors `cardTheme.tsx`).
  - Key: `mate:dash:layout:v1:{sessionId}`.
  - Exposes `{ layout, setLayout, reset, isCustomized }`.
  - `reset()` removes the storage key and restores `defaultLayout`.
  - Corrupt/invalid stored JSON → discard, fall back to default (never crash a
    client dashboard).
- **`DashEditBar`** — the control cluster. Off state: single "Customize" button
  (Phosphor icon, brand orange accent). On state: "Reset" + "Done" buttons and a
  short helper line ("drag to move, drag a corner to resize").
- **`DashboardView`** — refactor: the two independent masonry columns
  (`dash-col-left` / `dash-col-right`) become **one** grid engine (RGL or the
  dnd-kit grid). Hero + Ticker stay above it, outside the movable area. Default
  layout object reproduces today's arrangement exactly (left column: Lead flow,
  Speed, Pipeline, Ads; right column: Lead journey, Follow-up, Reputation,
  Operations; Calendar full-width above).

## Data flow

```
default layout (code)  ──┐
                         ├─> useDashLayout ─> grid engine ─> onLayoutChange ─> localStorage
localStorage (if any) ───┘                        ▲                                │
                                                  └──────── reset() clears ────────┘
```

No backend, no Supabase, no server action. Pure client + localStorage.

## Card identity

Each movable card needs a stable string id for the layout map. Reuse the
kebab-of-label convention already in `cardTheme.tsx` (e.g. `zone-leadflow`,
`zone-followup`) — several SectionCards already carry matching `id`s. Assign ids
to the ones that lack them.

## Edge cases / error handling

- **localStorage unavailable** (private mode): hook runs in-memory; layout is
  session-only, no crash. Same `try/catch` posture as `cardTheme.tsx`.
- **Stored layout references a card that no longer exists** (a future card is
  removed): grid engine ignores unknown ids; missing cards fall to default slot.
- **New card added in a later build** not present in a client's stored layout:
  append at the end of the grid with a default size; do not discard the client's
  saved positions.
- **Layout version bump**: the `v1` in the storage key lets a future breaking
  layout change invalidate old stored layouts by bumping to `v2`.
- **SSR hydration mismatch**: avoided by always rendering the default on the
  server + first client render, hydrating from storage only in `useEffect`.

## Testing

- **`useDashLayout.test.tsx`**: default on first render; hydrate from storage;
  `reset()` clears key + restores default; corrupt JSON → default; unknown-id
  filtering; unavailable-storage in-memory path.
- **`DashboardView.test.tsx`** (extend existing): edit-mode off → no drag/resize
  handles in DOM, cards static; edit-mode on (desktop) → handles present;
  edit-mode on (mobile) → drag handle present, resize handle absent; Hero +
  Ticker never receive drag handles.
- **Smoke test route** is throwaway — deleted before merge, not tested.

## Out of scope (YAGNI)

- Cross-device / per-account layout sync (localStorage only, per decision).
- Layout sharing / presets / multiple saved layouts.
- Resizing on mobile.
- Animated layout transitions beyond the grid engine's defaults.

## Brand / quality

Client-facing → follows `BRAND-GUIDE.md`. Edit-mode controls use Phosphor icons
(no Lucide, no emoji), brand orange `#e14d1a` accent, existing `Card`/theme
tokens. No em dashes in any UI copy. Handles and guides styled to the existing
light-theme card system, not stock RGL/dnd-kit chrome.
