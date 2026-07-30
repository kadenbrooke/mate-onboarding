'use client';
import {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { ResponsiveGridLayout, type Layout } from 'react-grid-layout';
import { DotsSixVertical, ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { useDashLayout } from './useDashLayout';
import {
  type DashLayout, GRID_COLS, GRID_ROW_HEIGHT, GRID_MARGIN,
  colSpanPx, pxToRows,
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
const MIN_H = 5;

/**
 * Desktop dashboard grid: drag to reorder, drag the SE corner to resize, all
 * gated behind `editing`. Off → cards are fully static (normal scroll/read).
 *
 * RGL uses fixed row-height cells but these cards are content-height, so on
 * first mount (when the client has no stored layout) we measure each card's
 * natural height at its exact grid-column width and build the default layout
 * from that — the default view matches the founder-designed heights. Once the
 * client drags or resizes, that arrangement is stored and measurement stops.
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
  const [measured, setMeasured] = useState<DashLayout | null>(null);

  // Track container width; a material change re-triggers measurement.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      setContainerW((prev) => {
        if (Math.abs(prev - w) > 2) { setMeasured(null); return w; }
        return prev;
      });
    };
    read();
    if (typeof ResizeObserver === 'undefined') return; // jsdom / non-browser
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const needMeasure = !isCustomized && containerW > 0 && measured === null;

  // Measure natural heights at each card's exact column width (pre-paint).
  useLayoutEffect(() => {
    if (!needMeasure) return;
    const next = defaultLayout.map((item) => {
      const el = measureRefs.current[item.i];
      if (!el) return item;
      return { ...item, h: Math.max(MIN_H, pxToRows(el.offsetHeight)) };
    });
    setMeasured(next);
  }, [needMeasure, containerW, geometryKey, defaultLayout]);

  const markInteracted = useCallback(() => { interacted.current = true; }, []);
  const handleLayoutChange = useCallback((next: Layout, all?: Partial<Record<'lg', Layout>>) => {
    // Only persist genuine user drags/resizes, not mount-time compaction or the
    // measurement-driven height correction.
    if (editing && interacted.current) setLayout([...(all?.lg ?? next)] as DashLayout);
  }, [editing, setLayout]);

  const effectiveLayout = isCustomized ? layout : (measured ?? defaultLayout);

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
            onClick={reset}
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

      {/* Hidden measurement layer: each card at its true grid-column width. */}
      {needMeasure && (
        <div aria-hidden style={{
          position: 'absolute', top: -99999, left: 0, visibility: 'hidden',
          pointerEvents: 'none',
        }}>
          {cards.map((c) => (
            <div
              key={c.id}
              ref={(el) => { measureRefs.current[c.id] = el; }}
              style={{ width: colSpanPx(containerW, c.w) }}
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
