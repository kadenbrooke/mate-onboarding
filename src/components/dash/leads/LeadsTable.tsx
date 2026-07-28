'use client';
import { useEffect, useRef, useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import { FREE_GREEN, LOST_BROWN, NUM_TABLE, FONT_BODY } from '@/lib/theme';

const dollars = (cents: number | null) => cents == null ? '' : `$${Math.round(cents / 100).toLocaleString()}`;

export function LeadsTable({ leads, sessionId, spotlightId }: {
  leads: Lead[]; sessionId: string; spotlightId: string | null;
}) {
  const [rows, setRows] = useState(leads);
  const spotRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (spotRef.current && typeof spotRef.current.scrollIntoView === 'function') {
      spotRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
              borderTop: '1px solid #222',
              background: l.id === spotlightId ? 'color-mix(in srgb, var(--brand-primary, #e14d1a) 12%, transparent)' : undefined,
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
                    style={{ background: FREE_GREEN, border: 'none', borderRadius: 6, color: '#fff', fontSize: 10, padding: '3px 8px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>WON</button>
                  <button type="button" onClick={() => mark(l.id, 'lost')} aria-label={`lost ${l.name}`}
                    style={{ background: LOST_BROWN, border: 'none', borderRadius: 6, color: '#fff', fontSize: 10, padding: '3px 8px', fontFamily: FONT_BODY, cursor: 'pointer' }}>LOST</button>
                </span>
              ) : (
                <b style={{ color: l.status === 'won' ? FREE_GREEN : LOST_BROWN }}>{l.status.toUpperCase()}</b>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
