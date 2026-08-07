import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Layout } from 'react-grid-layout';
import { MovableDashGrid, type MovableCard } from './MovableDashGrid';
import { pxToRows, type DashLayout } from '@/lib/dash/layout';

// Capture what MovableDashGrid hands RGL.
const rgl: { layouts: { lg: Layout } | null } = { layouts: null };
vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: (props: Record<string, unknown>) => {
    rgl.layouts = props.layouts as { lg: Layout };
    return props.children as React.ReactNode;
  },
}));

const SESSION = 'sess-heights';
const KEY = `mate:dash:layout:v1:${SESSION}`;
const CONTENT_PX = 200; // every measure node reports this natural height
const CONTENT_ROWS = pxToRows(CONTENT_PX); // 11 rows

const cards: MovableCard[] = [
  { id: 'zone-a', x: 0, y: 0, w: 6, node: <div>A</div> },
  { id: 'zone-b', x: 6, y: 0, w: 6, node: <div>B</div> },
];

const byId = (id: string) => (rgl.layouts?.lg ?? []).find((l) => l.i === id)!;

let heightSpy: PropertyDescriptor | undefined;
let widthSpy: PropertyDescriptor | undefined;

beforeEach(() => {
  window.localStorage.clear();
  rgl.layouts = null;
  cleanup();
  // jsdom reports 0 for layout metrics; feed real numbers so the measure layer
  // and the container-width probe behave like a browser.
  heightSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => CONTENT_PX });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1040 });
  // Minimal ResizeObserver so the browser code paths run.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  if (heightSpy) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightSpy);
  if (widthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthSpy);
  vi.unstubAllGlobals();
});

describe('MovableDashGrid content-height reconciliation', () => {
  it('pins h AND minH to measured content for the default layout (no clip, no gap)', () => {
    render(<MovableDashGrid sessionId={SESSION} cards={cards} editing={false} onDone={() => {}} />);
    for (const id of ['zone-a', 'zone-b']) {
      expect(byId(id).h).toBe(CONTENT_ROWS);
      expect(byId(id).minH).toBe(CONTENT_ROWS);
    }
  });

  it('overrides a stored layout\'s STALE height with live measurement, keeping x/y/w', () => {
    // A layout saved when content was much taller (h: 40) and with the old
    // fixed floor (minH: 5). On load it must reconcile to current content.
    const stale: DashLayout = [
      { i: 'zone-b', x: 0, y: 0, w: 6, h: 40, minH: 5 },
      { i: 'zone-a', x: 6, y: 0, w: 6, h: 40, minH: 5 },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(stale));

    render(<MovableDashGrid sessionId={SESSION} cards={cards} editing={false} onDone={() => {}} />);

    // Positions/order/width preserved from storage...
    expect(byId('zone-b')).toMatchObject({ x: 0, y: 0, w: 6 });
    expect(byId('zone-a')).toMatchObject({ x: 6, y: 0, w: 6 });
    // ...but the stale h:40 / minH:5 are replaced by measured content.
    expect(byId('zone-b').h).toBe(CONTENT_ROWS);
    expect(byId('zone-b').minH).toBe(CONTENT_ROWS);
    expect(byId('zone-a').h).toBe(CONTENT_ROWS);
    expect(byId('zone-a').minH).toBe(CONTENT_ROWS);
  });
});
