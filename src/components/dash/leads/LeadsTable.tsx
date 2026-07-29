'use client';
import { useEffect, useRef, useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import {
  FREE_GREEN, LOST_BROWN, BORDER_SOFT, TEXT_MUTED, NUM_TABLE, NUM_DISPLAY,
  FONT_BODY, scoreColor,
} from '@/lib/theme';

const dollars = (cents: number | null) => cents == null ? '' : `$${Math.round(cents / 100).toLocaleString()}`;

const SPOTLIGHT_BG = 'color-mix(in srgb, var(--brand-primary, #e14d1a) 12%, transparent)';

// Desktop: 7-column table. Mobile (<=640px): the table crushed unreadably at
// 390px, so leads render as stacked card rows with 40px WON/LOST buttons.
// Both variants render and CSS toggles display; state (optimistic status) is
// shared so switching breakpoints never desyncs.

export function LeadsTable({ leads, sessionId, spotlightId }: {
  leads: Lead[]; sessionId: string; spotlightId: string | null;
}) {
  const [rows, setRows] = useState(leads);
  const spotRef = useRef<HTMLTableRowElement>(null);
  const spotCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll whichever spotlight element is visible; display:none no-ops.
    for (const el of [spotRef.current, spotCardRef.current]) {
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, []);

  async function mark(id: string, status: 'won' | 'lost' | 'open') {
    setRows(r => r.map(l => l.id === id ? { ...l, status } : l));
    await fetch(`/api/leads/${id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, session_id: sessionId }),
    });
  }

  return (
    <>
      <style>{`
        @media (max-width: 640px) { .leads-desktop { display: none !important; } }
        @media (min-width: 641px) { .leads-mobile { display: none !important; } }
      `}</style>

      {/* Desktop table */}
      <table className="leads-desktop" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: .5, fontSize: 10, letterSpacing: 1, fontFamily: FONT_BODY }}>
            <th style={{ padding: 8 }}>SCORE</th><th>NAME</th><th>SERVICE</th><th>CITY</th>
            <th>SOURCE</th><th>QUOTE</th><th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.id} data-testid={`lead-row-${l.id}`} data-status={l.status}
              data-spotlight={l.id === spotlightId ? 'true' : 'false'}
              ref={l.id === spotlightId ? spotRef : undefined}
              style={{
                borderTop: `1px solid ${BORDER_SOFT}`,
                background: l.id === spotlightId ? SPOTLIGHT_BG : undefined,
              }}>
              {/* Score: tnum Geist 400 -- column of aligned numerics */}
              <td style={{ padding: 8, ...NUM_TABLE }}>{l.score ?? ''}</td>
              <td>{l.name}</td><td>{l.service}</td><td>{l.city}</td>
              <td style={{ color: ['referral', 'revived'].includes(l.source) ? FREE_GREEN : undefined }}>{l.source.replaceAll('_', ' ')}</td>
              <td>{dollars(l.quote_cents)}</td>
              <td>
                {l.status === 'open' ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => mark(l.id, 'won')} aria-label={`won ${l.name}`}
                      style={{ background: FREE_GREEN, border: 'none', borderRadius: 99, color: '#fff', fontSize: 10, padding: '3px 9px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>WON</button>
                    <button type="button" onClick={() => mark(l.id, 'lost')} aria-label={`lost ${l.name}`}
                      style={{ background: LOST_BROWN, border: 'none', borderRadius: 99, color: '#fff', fontSize: 10, padding: '3px 9px', fontFamily: FONT_BODY, cursor: 'pointer' }}>LOST</button>
                  </span>
                ) : (
                  <b style={{ color: l.status === 'won' ? FREE_GREEN : LOST_BROWN }}>{l.status.toUpperCase()}</b>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card list */}
      <div className="leads-mobile" style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((l, i) => (
          <div
            key={l.id}
            data-testid={`lead-card-${l.id}`}
            data-status={l.status}
            data-spotlight={l.id === spotlightId ? 'true' : 'false'}
            ref={l.id === spotlightId ? spotCardRef : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 8px',
              borderTop: i > 0 ? `1px solid ${BORDER_SOFT}` : undefined,
              background: l.id === spotlightId ? SPOTLIGHT_BG : undefined,
              borderRadius: l.id === spotlightId ? 10 : undefined,
            }}
          >
            {/* Score: traffic-light colored display numeral */}
            <span style={{
              ...NUM_DISPLAY, fontSize: 20, minWidth: 32, textAlign: 'right',
              flexShrink: 0, color: l.score != null ? scoreColor(l.score) : TEXT_MUTED,
            }}>
              {l.score ?? '--'}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                {l.quote_cents != null && (
                  <span style={{ ...NUM_TABLE, fontSize: 12, color: TEXT_MUTED, flexShrink: 0 }}>{dollars(l.quote_cents)}</span>
                )}
              </div>
              <div style={{
                fontSize: 11, color: TEXT_MUTED, fontFamily: FONT_BODY, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[l.service, l.city].filter(Boolean).join(' · ')}
                {' · '}
                <span style={{ color: ['referral', 'revived'].includes(l.source) ? FREE_GREEN : undefined }}>
                  {l.source.replaceAll('_', ' ')}
                </span>
              </div>
            </div>

            {l.status === 'open' ? (
              <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => mark(l.id, 'won')} aria-label={`mark won ${l.name}`}
                  style={{ background: FREE_GREEN, border: 'none', borderRadius: 99, color: '#fff', fontSize: 11, minHeight: 40, padding: '0 14px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>WON</button>
                <button type="button" onClick={() => mark(l.id, 'lost')} aria-label={`mark lost ${l.name}`}
                  style={{ background: LOST_BROWN, border: 'none', borderRadius: 99, color: '#fff', fontSize: 11, minHeight: 40, padding: '0 14px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>LOST</button>
              </span>
            ) : (
              <b style={{ color: l.status === 'won' ? FREE_GREEN : LOST_BROWN, fontSize: 12, fontFamily: FONT_BODY, flexShrink: 0 }}>
                {l.status.toUpperCase()}
              </b>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
