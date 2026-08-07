'use client';
import {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { ResponsiveGridLayout, type Layout } from 'react-grid-layout';
import { DotsSixVertical, ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { useDashLayout } from './useDashLayout';
import {
  type DashLayout, GRID_COLS, GRID_ROW_HEIGHT, GRID_MARGIN,
  colSpanPx, pxToRows, applyContentHeights,
} from '@/lib/dash/layout';
import {
  brandVar, BG_SECTION, BORDER_SOFT, TEXT_DARK, TEXT_MUTED, FONT_BODY,
} from '@/lib/theme';

/** A movable card: stable geometry (id/x/y/w) + the rendered node. */
export interface MovableCard {
  id: string;
  x: number;
  y: number;
  w: number;
  node: React.ReactNode;
}

const FALLBACK_H = 24; // rows, used only for the sub-frame before measurement
const MIN_W = 3; // 12 / 3 = up to 4 cards across a row
const MIN_H = 1; // pre-measurement placeholder; the real floor is content height

/**
 * Desktop dashboard grid: drag to reorder, drag the SE corner to resize, all
 * gated behind `editing`. Off → cards are fully static (normal scroll/read).
 *
 * RGL uses fixed row-height cells but these cards are content-height. A hidden
 * measure layer renders every card at its exact grid-column width and reports
 * each card's natural pixel height; that height (in rows) is pinned onto BOTH
 * `h` and `minH` for every card — stored layouts included — via
 * `applyContentHeights`. Consequences:
 *   - a card can never be compacted or resized shorter than its content (no
 *     clipping — bug 1), because `minH` == content rows;
 *   - a card never grows past its content (no dead space below — bug 2),
 *     because `h` == content rows;
 *   - a restored custom layout is re-measured against the CURRENT data on every
 *     load, so a saved arrangement never renders "reset"/broken when the data
 *     (and thus content height) has shifted since it was saved (bug 3). Only
 *     x/y/w/order come from storage; height is always live.
 * Measurement is continuous (ResizeObserver on the measure layer), so data
 * updates that change a card's height reflow it without a reload.
 */
export function MovableDashGrid({ sessionId, cards, editing, onDone }: {
  sessionId: string;
  cards: MovableCard[];
  editing: boolean;
  onDone?: () => void;
}) {
  // Stable geometry key: default layout must not change identity when only the
  // card nodes re-render (data updates), or the hook would thrash.
  const geometryKey = cards.map((c) => `${c.id}:${c.x}:${c.y}:${c.w}`).join('|');
  const defaultLayout = useMemo<DashLayout>(
    () => cards.map((c) => ({
      i: c.id, x: c.x, y: c.y, w: c.w, h: FALLBACK_H, minW: MIN_W, minH: MIN_H,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey],
  );

  const { layout, setLayout, reset, isCustomized } = useDashLayout(sessionId, defaultLayout);

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const interacted = useRef(false);
  const [containerW, setContainerW] = useState(0);
  // Measured natural content height, in grid rows, per card id. The single
  // source of truth for every card's height — see applyContentHeights.
  const [contentRows, setContentRows] = useState<Record<string, number>>({});

  // Position/width/order source: the stored layout once customized, else the
  // founder-designed default. Heights on these are placeholders; the measured
  // heights are layered on below and always win.
  const basePositions = isCustomized ? layout : defaultLayout;

  // Current column width per card (a resize changes `w`, which changes content
  // height, which must be re-measured). Keyed so the measure layer + observers
  // re-run when any width changes, not on every unrelated re-render.
  const widthKey = basePositions.map((i) => `${i.i}:${i.w}`).join('|');
  const widthFor = useCallback(
    (id: string) => basePositions.find((i) => i.i === id)?.w ?? cards.find((c) => c.id === id)?.w ?? 6,
    [basePositions, cards],
  );

  // Track container width (drives the measure-layer column math).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      setContainerW((prev) => (Math.abs(prev - w) > 2 ? w : prev));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return; // jsdom / non-browser
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Read every card's natural height from the measure layer into contentRows.
  // Idempotent: only writes ids whose row count actually changed, so it can be
  // called freely from a ResizeObserver without looping.
  const measureNow = useCallback(() => {
    if (containerW <= 0) return;
    setContentRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of cards) {
        const el = measureRefs.current[c.id];
        if (!el) continue;
        const rows = pxToRows(el.offsetHeight);
        if (next[c.id] !== rows) { next[c.id] = rows; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cards, containerW]);

  // Measure on mount and whenever width or a card's column-span changes.
  useLayoutEffect(() => { measureNow(); }, [measureNow, widthKey, geometryKey]);

  // Re-measure when a card's content height changes (data updates), keeping the
  // grid in sync without a reload.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureNow());
    for (const c of cards) { const el = measureRefs.current[c.id]; if (el) ro.observe(el); }
    return () => ro.disconnect();
    // widthKey/geometryKey re-attach observers when the node set or widths change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureNow, widthKey, geometryKey]);

  const markInteracted = useCallback(() => { interacted.current = true; }, []);
  const handleLayoutChange = useCallback((next: Layout, all?: Partial<Record<'lg', Layout>>) => {
    // Only persist genuine user drags/resizes, not mount-time compaction or the
    // measurement-driven height correction.
    if (editing && interacted.current) setLayout([...(all?.lg ?? next)] as DashLayout);
  }, [editing, setLayout]);

  // Reset also clears the interaction flag: without this, a compaction event
  // fired right after reset (while still editing) would re-persist the default
  // as a "custom" layout, silently undoing the reset.
  const handleReset = useCallback(() => { interacted.current = false; reset(); }, [reset]);

  // Height is always live: pin measured content rows onto h AND minH for every
  // card, stored or default. Positions/width/order come from basePositions.
  const effectiveLayout = useMemo(
    () => applyContentHeights(basePositions, contentRows),
    [basePositions, contentRows],
  );

  return (
    <div ref={containerRef} className={editing ? 'dash-rgl-wrap dash-editing' : 'dash-rgl-wrap'}>
      {editing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          padding: '8px 12px', borderRadius: 14, background: BG_SECTION,
          border: `1px solid ${BORDER_SOFT}`,
        }}>
          <span style={{ fontSize: 12, color: TEXT_MUTED, fontFamily: FONT_BODY, flex: 1 }}>
            Drag a card to move it, drag its bottom-right corner to resize.
          </span>
          <button
            type="button"
            onClick={handleReset}
            disabled={!isCustomized}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px',
              borderRadius: 999, border: `1px solid ${BORDER_SOFT}`, background: '#fff',
              color: TEXT_DARK, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600,
              cursor: isCustomized ? 'pointer' : 'default', opacity: isCustomized ? 1 : 0.5,
            }}
          >
            <ArrowCounterClockwise size={13} weight="bold" aria-hidden /> Reset
          </button>
          <button
            type="button"
            onClick={onDone}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 14px',
              borderRadius: 999, border: 'none', background: brandVar, color: '#fff',
              fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <Check size={13} weight="bold" aria-hidden /> Done
          </button>
        </div>
      )}

      {/* Hidden measurement layer: each card rendered at its CURRENT grid-column
          width so its natural height can be read continuously. Always mounted
          (not just on first paint) so a restored custom layout and any later
          data-driven content change both re-measure. Offscreen + hidden so it
          never paints or catches pointer events. */}
      {containerW > 0 && (
        <div aria-hidden style={{
          position: 'absolute', top: -99999, left: 0, visibility: 'hidden',
          pointerEvents: 'none', width: containerW,
        }}>
          {cards.map((c) => (
            <div
              key={c.id}
              ref={(el) => { measureRefs.current[c.id] = el; }}
              style={{ width: colSpanPx(containerW, widthFor(c.id)) }}
            >
              {c.node}
            </div>
          ))}
        </div>
      )}

      <ResponsiveGridLayout
        className="dash-rgl"
        width={containerW || 1040}
        breakpoints={{ lg: 0 }}
        cols={{ lg: GRID_COLS }}
        layouts={{ lg: effectiveLayout }}
        rowHeight={GRID_ROW_HEIGHT}
        margin={[GRID_MARGIN, GRID_MARGIN]}
        containerPadding={[0, 0]}
        dragConfig={{ enabled: editing, handle: '.dash-drag' }}
        resizeConfig={{ enabled: editing, handles: ['se'] }}
        onDragStart={markInteracted}
        onResizeStart={markInteracted}
        onLayoutChange={handleLayoutChange}
      >
        {cards.map((c) => (
          <div key={c.id} id={c.id} className="dash-cell" style={{ overflow: 'hidden', borderRadius: 24, scrollMarginTop: 12 }}>
            {editing && (
              <div
                className="dash-drag"
                title="Drag to move"
                style={{
                  position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
                  display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px',
                  borderRadius: 999, background: brandVar, color: '#fff',
                  cursor: 'grab', zIndex: 5, boxShadow: '0 1px 4px rgba(20,20,20,0.25)',
                }}
              >
                <DotsSixVertical size={13} weight="bold" aria-hidden />
              </div>
            )}
            <div style={{ height: '100%', overflow: 'hidden' }}>{c.node}</div>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
