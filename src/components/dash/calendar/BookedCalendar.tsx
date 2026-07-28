'use client';
import { useEffect, useState } from 'react';
import { monthGrid } from '@/lib/metrics/calendar';
import { moneyShort } from '@/lib/metrics/format';
import { BRAND_RAMP } from '@/lib/metrics/colors';
import { NUM_TABLE, brandVar, FONT_BODY } from '@/lib/theme';
import { Card } from '../Card';
import type { Appointment } from '@/lib/metrics/calendar';

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function BookedCalendar({ appointments }: { appointments: Appointment[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div style={{ height: 320 }} />;

  const grid = monthGrid(appointments);
  const isEmpty = grid.totalCount === 0;

  const rightSlot = (
    <span style={{ fontSize: 11, fontWeight: 700, color: brandVar }}>
      {grid.totalCount} booked
    </span>
  );

  return (
    <Card label={`${grid.monthLabel} BOOKED APPOINTMENTS`} right={rightSlot}>
      {/* Mo-Su header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginTop: 10, marginBottom: 4,
      }}>
        {DAY_HEADERS.map(h => (
          <div key={h} style={{ fontSize: 9, opacity: 0.4, textAlign: 'center', fontFamily: FONT_BODY }}>
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {grid.weeks.flat().map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} style={{ background: '#141414', border: '1px solid #222', borderRadius: 4, minHeight: 36 }} />;
            }
            const isToday = cell.isToday;
            const now = new Date();
            const cellDate = new Date(now.getFullYear(), now.getMonth(), cell.day);
            const isFuture = cellDate > now && !isToday;
            const appts = cell.appointments;

            const titleLines = appts
              .map(a => [a.customer_name, a.service].filter(Boolean).join(' - '))
              .join('\n');

            return (
              <div
                key={`day-${cell.day}`}
                title={titleLines || undefined}
                style={{
                  background: '#141414',
                  border: isToday ? `1px solid ${brandVar}` : '1px solid #222',
                  borderRadius: 4,
                  minHeight: 36,
                  padding: '3px 4px',
                  opacity: isFuture ? 0.5 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{
                  fontSize: 8,
                  color: isToday ? brandVar : '#666',
                  lineHeight: 1,
                }}>
                  {cell.day}
                </span>
                {appts.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
                    {appts.slice(0, 3).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: BRAND_RAMP[i % 3],
                          flexShrink: 0,
                        }}
                      />
                    ))}
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
            <span style={{ fontSize: 11, opacity: 0.5, textAlign: 'center', fontFamily: FONT_BODY }}>
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
        <span style={{ opacity: 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
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
