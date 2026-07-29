'use client';
import { useEffect, useRef, useState } from 'react';
import { monthGrid } from '@/lib/metrics/calendar';
import { moneyShort } from '@/lib/metrics/format';
import {
  brandVar, BG_SECTION, BORDER_SOFT, TEXT_MUTED, TEXT_FAINT, CARD_SHADOW,
  NUM_TABLE, FONT_BODY,
} from '@/lib/theme';
import { Card } from '../Card';
import type { Appointment } from '@/lib/metrics/calendar';

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export type PopoverAlign = 'left' | 'center' | 'right';

/** Popover with one appointment's details. Anchored above the dot's cell.
 *  `align` clamps edge-column popovers inside the viewport: left columns
 *  extend rightward, right columns leftward, so nothing clips offscreen. */
function ApptPopover({ appt, align = 'center' }: { appt: Appointment; align?: PopoverAlign }) {
  const alignStyle: React.CSSProperties =
    align === 'left' ? { left: -6 }
    : align === 'right' ? { right: -6 }
    : { left: '50%', transform: 'translateX(-50%)' };
  return (
    <div
      role="dialog"
      aria-label="Appointment details"
      data-testid="appt-popover"
      data-align={align}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        ...alignStyle,
        zIndex: 20,
        background: '#ffffff',
        border: `1px solid ${BORDER_SOFT}`,
        borderRadius: 10,
        boxShadow: CARD_SHADOW,
        padding: '8px 10px',
        minWidth: 130,
        fontFamily: FONT_BODY,
        fontSize: 11,
        textAlign: 'left',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontWeight: 600 }}>{appt.customer_name ?? 'Appointment'}</div>
      <div style={{ color: TEXT_MUTED, marginTop: 2 }}>
        {[formatTime(appt.starts_at), appt.service].filter(Boolean).join(' · ')}
      </div>
      {appt.price_cents != null && (
        <div style={{ ...NUM_TABLE, color: brandVar, marginTop: 2 }}>
          {moneyShort(appt.price_cents)}
        </div>
      )}
    </div>
  );
}

export function BookedCalendar({ appointments, showLabel = true, wide = false }: {
  appointments: Appointment[];
  /** Desktop suppresses the card label: the surrounding SectionCard carries it. */
  showLabel?: boolean;
  /** Full-width slot: fixed-height day rows instead of square cells. */
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  // Sticky popover key ("day-index"): set on tap/click, cleared on tap-away
  // or Escape. Hover shows the same popover transiently.
  const [stickyKey, setStickyKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (stickyKey == null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setStickyKey(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStickyKey(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [stickyKey]);

  if (!mounted) return <div style={{ height: wide ? 260 : 320 }} />;

  const grid = monthGrid(appointments);
  const isEmpty = grid.totalCount === 0;
  const activeKey = stickyKey ?? hoverKey;

  // When the SectionCard carries the zone label, the right slot keeps the
  // month context that would otherwise be lost with the card label.
  const rightSlot = (
    <span style={{ fontSize: 11, fontWeight: 700, color: brandVar }}>
      {showLabel ? `${grid.totalCount} booked` : `${grid.monthLabel} · ${grid.totalCount} booked`}
    </span>
  );

  // Wide slots drop the square aspect so a full month stays a short strip.
  const cellShape: React.CSSProperties = wide ? { height: 44 } : { aspectRatio: '1 / 1' };

  return (
    <Card label={showLabel ? `${grid.monthLabel} BOOKED APPOINTMENTS` : undefined} right={rightSlot}>
      {/* Mo-Su header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginTop: 10, marginBottom: 4,
      }}>
        {DAY_HEADERS.map(h => (
          <div key={h} style={{ fontSize: 9, color: TEXT_FAINT, textAlign: 'center', fontFamily: FONT_BODY }}>
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ position: 'relative' }} ref={wrapRef}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {grid.weeks.flat().map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} style={{
                background: 'transparent', border: `1px solid ${BORDER_SOFT}`,
                borderRadius: 8, ...cellShape,
              }} />;
            }
            const isToday = cell.isToday;
            const now = new Date();
            const cellDate = new Date(now.getFullYear(), now.getMonth(), cell.day);
            const isFuture = cellDate > now && !isToday;
            const appts = cell.appointments;
            // Column position drives popover alignment (edge columns clamp
            // inward so the popover never clips outside the viewport).
            const col = idx % 7;
            const popAlign: PopoverAlign = col <= 1 ? 'left' : col >= 5 ? 'right' : 'center';

            return (
              <div
                key={`day-${cell.day}`}
                data-testid={`day-cell-${cell.day}`}
                // The 10px dots are sub-44px targets; on days with bookings the
                // whole ~44px cell toggles the first appointment's popover, so
                // the effective mobile touch target is the full cell. Dots
                // stopPropagation, so precise taps still pick a specific one.
                onClick={appts.length > 0 ? () => setStickyKey(k => (k === `${cell.day}-0` ? null : `${cell.day}-0`)) : undefined}
                style={{
                  cursor: appts.length > 0 ? 'pointer' : undefined,
                  background: BG_SECTION,
                  border: isToday ? `1px solid ${brandVar}` : `1px solid ${BORDER_SOFT}`,
                  borderRadius: 8,
                  ...cellShape,
                  padding: '3px 4px',
                  opacity: isFuture ? 0.6 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 9,
                  color: isToday ? brandVar : TEXT_MUTED,
                  fontWeight: isToday ? 700 : 400,
                  lineHeight: 1,
                }}>
                  {cell.day}
                </span>
                {appts.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
                    {appts.slice(0, 3).map((a, i) => {
                      const key = `${cell.day}-${i}`;
                      const open = activeKey === key;
                      return (
                        <span key={key} style={{ position: 'relative', display: 'inline-flex' }}>
                          <button
                            type="button"
                            className="dash-tap-y"
                            aria-label={`Appointment: ${a.customer_name ?? 'unknown'} on day ${cell.day}`}
                            aria-expanded={open}
                            data-testid={`appt-dot-${key}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStickyKey(k => (k === key ? null : key));
                            }}
                            onMouseEnter={() => setHoverKey(key)}
                            onMouseLeave={() => setHoverKey(k => (k === key ? null : k))}
                            onFocus={() => setHoverKey(key)}
                            onBlur={() => setHoverKey(k => (k === key ? null : k))}
                            style={{
                              width: 10, height: 10, borderRadius: '50%',
                              background: brandVar,
                              border: 'none', padding: 0, cursor: 'pointer',
                              flexShrink: 0,
                              outlineOffset: 2,
                            }}
                          />
                          {open && <ApptPopover appt={a} align={popAlign} />}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty state overlay */}
        {isEmpty && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 11, color: TEXT_MUTED, textAlign: 'center', fontFamily: FONT_BODY }}>
              Appointments your agents book will land here
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, fontSize: 10,
      }}>
        <span style={{ color: TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 5, fontFamily: FONT_BODY }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: brandVar,
          }} />
          Booked by your agents
        </span>
        <span style={{ ...NUM_TABLE, fontWeight: 700 }}>
          {moneyShort(grid.totalCents)} on the books
        </span>
      </div>
    </Card>
  );
}
