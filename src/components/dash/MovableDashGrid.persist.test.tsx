import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { Layout } from 'react-grid-layout';
import { MovableDashGrid, type MovableCard } from './MovableDashGrid';
import { loadLayout, type DashLayout } from '@/lib/dash/layout';

// --- Faithful react-grid-layout stand-in -----------------------------------
// Captures the props MovableDashGrid hands RGL and exposes the callbacks so a
// test can replay the exact events real RGL fires: onDragStart on interaction,
// onLayoutChange after a drag/compaction. Renders children so the tree mounts.
const rgl: {
  layouts: { lg: Layout } | null;
  onLayoutChange: ((l: Layout, all?: { lg: Layout }) => void) | null;
  onDragStart: (() => void) | null;
} = { layouts: null, onLayoutChange: null, onDragStart: null };

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: (props: Record<string, unknown>) => {
    rgl.layouts = props.layouts as { lg: Layout };
    rgl.onLayoutChange = props.onLayoutChange as typeof rgl.onLayoutChange;
    rgl.onDragStart = props.onDragStart as typeof rgl.onDragStart;
    return props.children as React.ReactNode;
  },
}));

const SESSION = 'sess-persist';
const KEY = `mate:dash:layout:v1:${SESSION}`;

const cards: MovableCard[] = [
  { id: 'zone-a', x: 0, y: 0, w: 6, node: <div>A</div> },
  { id: 'zone-b', x: 6, y: 0, w: 6, node: <div>B</div> },
  { id: 'zone-c', x: 0, y: 1, w: 12, node: <div>C</div> },
];

/** The order (by id) RGL is currently being asked to render. */
const renderedOrder = () => (rgl.layouts?.lg ?? []).map((l) => l.i);

function mount(editing: boolean) {
  return render(
    <MovableDashGrid sessionId={SESSION} cards={cards} editing={editing} onDone={() => {}} />,
  );
}

describe('MovableDashGrid persistence contract', () => {
  beforeEach(() => {
    window.localStorage.clear();
    rgl.layouts = null; rgl.onLayoutChange = null; rgl.onDragStart = null;
    cleanup();
  });

  it('a user drag persists, and survives an unmount/remount (a "login")', () => {
    const { unmount } = mount(true);

    // User grabs a card (RGL fires onDragStart), reorders A<->B, drops
    // (RGL fires onLayoutChange with the new geometry).
    const reordered: DashLayout = [
      { i: 'zone-b', x: 0, y: 0, w: 6, h: 8 },
      { i: 'zone-a', x: 6, y: 0, w: 6, h: 8 },
      { i: 'zone-c', x: 0, y: 1, w: 12, h: 8 },
    ];
    act(() => { rgl.onDragStart?.(); });
    act(() => { rgl.onLayoutChange?.(reordered, { lg: reordered }); });

    expect(loadLayout(SESSION)).toEqual(reordered);

    // Second "login": remount fresh.
    unmount();
    rgl.layouts = null;
    mount(false);

    expect(renderedOrder()).toEqual(['zone-b', 'zone-a', 'zone-c']);
  });

  it('mount with a stored layout does NOT clobber it via mount-time compaction', () => {
    const stored: DashLayout = [
      { i: 'zone-c', x: 0, y: 0, w: 12, h: 5 },
      { i: 'zone-a', x: 0, y: 5, w: 6, h: 5 },
      { i: 'zone-b', x: 6, y: 5, w: 6, h: 5 },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(stored));

    mount(false);

    // RGL fires onLayoutChange on mount after compacting (not a user action).
    const compacted: DashLayout = stored.map((l) => ({ ...l, h: 4 }));
    act(() => { rgl.onLayoutChange?.(compacted, { lg: compacted }); });

    // The stored layout must be untouched — no user ever interacted.
    expect(loadLayout(SESSION)).toEqual(stored);
  });

  it('editing + compaction WITHOUT a user drag does NOT overwrite storage', () => {
    const stored: DashLayout = [
      { i: 'zone-a', x: 0, y: 0, w: 6, h: 5 },
      { i: 'zone-b', x: 6, y: 0, w: 6, h: 5 },
      { i: 'zone-c', x: 0, y: 5, w: 12, h: 5 },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(stored));

    mount(true); // editing on, but user has not grabbed anything yet

    const compacted: DashLayout = stored.map((l) => ({ ...l, h: 3 }));
    act(() => { rgl.onLayoutChange?.(compacted, { lg: compacted }); });

    expect(loadLayout(SESSION)).toEqual(stored);
  });
});
