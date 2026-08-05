'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass, CaretRight } from '@phosphor-icons/react';
import type { Lead } from '@/lib/metrics/leads';
import {
  FREE_GREEN, LOST_BROWN, BORDER_SOFT, TEXT_MUTED, TEXT_DARK, TEXT_FAINT, BG_CARD,
  NUM_TABLE, NUM_DISPLAY, FONT_BODY, scoreColor,
} from '@/lib/theme';
import {
  searchLeads, applySort, cycleSort, SORT_CHIPS, type SortEntry,
} from './leadsControls';
import { DriverPill } from './DriverPill';
import { normalizeHandler, toggleHandler, type HandlerState } from './driverToggle';

const dollars = (cents: number | null) => cents == null ? '' : `$${Math.round(cents / 100).toLocaleString()}`;

const SPOTLIGHT_BG = 'color-mix(in srgb, var(--brand-primary, #e14d1a) 12%, transparent)';

// Desktop: 8-column table (SCORE NAME SERVICE CITY SOURCE QUOTE DRIVER STATUS)
// plus a trailing chevron. Mobile (<=640px): the table crushed unreadably at
// 390px, so leads render as stacked card rows with 40px WON/LOST buttons and the
// Driver pill inline. Both variants render and CSS toggles display; state
// (optimistic status + handler) is shared so switching breakpoints never desyncs.
//
// A row (or the trailing chevron) opens the lead's conversation thread via the
// ?spotlight= param -- the same navigation HotLeads uses -- so the full thread
// and its Take-over control are reachable straight from the table.

export function LeadsTable({ leads, sessionId, spotlightId }: {
  leads: Lead[]; sessionId: string; spotlightId: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(leads);
  const [query, setQuery] = useState('');
  // Per-lead driver in-flight + error state (keyed by lead id).
  const [driverBusy, setDriverBusy] = useState<Record<string, boolean>>({});
  const [driverErr, setDriverErr] = useState<Record<string, string | null>>({});
  // Default sort: open leads first (open>won>lost), then highest score first.
  const [sort, setSort] = useState<SortEntry[]>([
    { key: 'status', dir: 'asc' },
    { key: 'score', dir: 'desc' },
  ]);
  const visible = useMemo(
    () => applySort(searchLeads(rows, query), sort),
    [rows, query, sort],
  );
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

  function openThread(id: string) {
    router.push(`/dash/${sessionId}/leads?spotlight=${id}`);
  }

  async function toggleDriver(id: string) {
    if (driverBusy[id]) return; // guard against overlapping PATCHes
    const current: HandlerState = normalizeHandler(rows.find(l => l.id === id)?.handler);
    setDriverBusy(b => ({ ...b, [id]: true }));
    setDriverErr(e => ({ ...e, [id]: null }));
    await toggleHandler({
      leadId: id, sessionId, current,
      apply: (h) => setRows(r => r.map(l => l.id === id ? { ...l, handler: h } : l)),
      onError: (msg) => setDriverErr(e => ({ ...e, [id]: msg })),
    });
    setDriverBusy(b => ({ ...b, [id]: false }));
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '4px 4px 12px' }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flex: '1 1 200px',
          background: BG_CARD, border: `1px solid ${BORDER_SOFT}`, borderRadius: 99,
          padding: '6px 12px', color: TEXT_MUTED,
        }}>
          <MagnifyingGlass size={14} aria-hidden />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search leads" aria-label="Search leads"
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontFamily: FONT_BODY, fontSize: 13, color: TEXT_DARK, width: '100%',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SORT_CHIPS.map(chip => {
            const entry = sort.find(e => e.key === chip.key);
            const active = !!entry;
            const order = sort.findIndex(e => e.key === chip.key);
            return (
              <button
                key={chip.key} type="button" onClick={() => setSort(s => cycleSort(s, chip.key))}
                aria-pressed={active}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  borderRadius: 99, padding: '5px 12px', cursor: 'pointer',
                  fontFamily: FONT_BODY, fontSize: 12, fontWeight: active ? 600 : 500,
                  border: `1px solid ${active ? 'var(--brand-primary, #e14d1a)' : BORDER_SOFT}`,
                  background: active ? 'var(--brand-primary, #e14d1a)' : BG_CARD,
                  color: active ? '#fff' : TEXT_MUTED,
                }}
              >
                {chip.label}
                {active && <span aria-hidden>{entry!.dir === 'asc' ? '↑' : '↓'}</span>}
                {active && sort.length > 1 && (
                  <span aria-hidden style={{ fontSize: 9, opacity: 0.8 }}>{order + 1}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) { .leads-desktop { display: none !important; } }
        @media (min-width: 641px) { .leads-mobile { display: none !important; } }
        .leads-row { cursor: pointer; }
        .leads-row:hover { background: rgba(20,20,20,0.025); }
        .lead-open { cursor: pointer; }
        .driver-pill:focus-visible, .lead-open:focus-visible {
          outline: 2px solid rgba(20,20,20,0.55); outline-offset: 2px; border-radius: 99px;
        }
      `}</style>

      {/* Desktop table */}
      <table className="leads-desktop" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: .5, fontSize: 10, letterSpacing: 1, fontFamily: FONT_BODY }}>
            <th style={{ padding: 8 }}>SCORE</th><th>NAME</th><th>SERVICE</th><th>CITY</th>
            <th>SOURCE</th><th>QUOTE</th><th>DRIVER</th><th>STATUS</th><th aria-hidden></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(l => (
            <tr key={l.id} data-testid={`lead-row-${l.id}`} data-status={l.status}
              data-handler={normalizeHandler(l.handler)}
              data-spotlight={l.id === spotlightId ? 'true' : 'false'}
              className="leads-row"
              onClick={() => openThread(l.id)}
              ref={l.id === spotlightId ? spotRef : undefined}
              style={{
                borderTop: `1px solid ${BORDER_SOFT}`,
                background: l.id === spotlightId ? SPOTLIGHT_BG : undefined,
              }}>
              {/* Score: tnum Geist 400 -- column of aligned numerics */}
              <td style={{ padding: 8, ...NUM_TABLE, color: l.score != null ? scoreColor(l.score) : undefined, fontWeight: l.score != null ? 600 : undefined }}>{l.score ?? ''}</td>
              <td>{l.name}</td><td>{l.service}</td><td>{l.city}</td>
              <td style={{ color: ['referral', 'revived'].includes(l.source) ? FREE_GREEN : undefined }}>{l.source.replaceAll('_', ' ')}</td>
              <td>{dollars(l.quote_cents)}</td>
              <td>
                <DriverPill
                  handler={normalizeHandler(l.handler)}
                  name={l.name}
                  busy={driverBusy[l.id]}
                  error={driverErr[l.id]}
                  onToggle={() => toggleDriver(l.id)}
                  testId={`driver-pill-${l.id}`}
                />
              </td>
              <td>
                {l.status === 'open' ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); mark(l.id, 'won'); }} aria-label={`won ${l.name}`}
                      style={{ background: 'transparent', border: `1px solid ${FREE_GREEN}`, borderRadius: 99, color: FREE_GREEN, fontSize: 10, padding: '3px 9px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>WON</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); mark(l.id, 'lost'); }} aria-label={`lost ${l.name}`}
                      style={{ background: 'transparent', border: `1px solid ${LOST_BROWN}`, borderRadius: 99, color: LOST_BROWN, fontSize: 10, padding: '3px 9px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>LOST</button>
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-block', borderRadius: 99, padding: '3px 10px',
                    fontSize: 10, fontWeight: 700, fontFamily: FONT_BODY, color: '#fff',
                    background: l.status === 'won' ? FREE_GREEN : LOST_BROWN,
                  }}>{l.status.toUpperCase()}</span>
                )}
              </td>
              {/* Trailing chevron: keyboard-accessible affordance to open the thread */}
              <td style={{ textAlign: 'right', paddingRight: 6 }}>
                <button type="button" className="lead-open"
                  onClick={(e) => { e.stopPropagation(); openThread(l.id); }}
                  aria-label={`Open conversation with ${l.name?.trim() || 'this lead'}`}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: TEXT_FAINT, display: 'inline-flex', padding: 4 }}>
                  <CaretRight size={14} weight="bold" aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card list */}
      <div className="leads-mobile" style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map((l, i) => (
          <div
            key={l.id}
            data-testid={`lead-card-${l.id}`}
            data-status={l.status}
            data-handler={normalizeHandler(l.handler)}
            data-spotlight={l.id === spotlightId ? 'true' : 'false'}
            className="leads-row"
            onClick={() => openThread(l.id)}
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
              {/* Driver pill on its own line so it stays tappable without crowding the meta row */}
              <div style={{ marginTop: 6 }}>
                <DriverPill
                  handler={normalizeHandler(l.handler)}
                  name={l.name}
                  busy={driverBusy[l.id]}
                  error={driverErr[l.id]}
                  onToggle={() => toggleDriver(l.id)}
                  testId={`driver-pill-card-${l.id}`}
                />
              </div>
            </div>

            {l.status === 'open' ? (
              <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={(e) => { e.stopPropagation(); mark(l.id, 'won'); }} aria-label={`mark won ${l.name}`}
                  style={{ background: 'transparent', border: `1px solid ${FREE_GREEN}`, borderRadius: 99, color: FREE_GREEN, fontSize: 11, minHeight: 40, padding: '0 14px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>WON</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); mark(l.id, 'lost'); }} aria-label={`mark lost ${l.name}`}
                  style={{ background: 'transparent', border: `1px solid ${LOST_BROWN}`, borderRadius: 99, color: LOST_BROWN, fontSize: 11, minHeight: 40, padding: '0 14px', fontFamily: FONT_BODY, fontWeight: 600, cursor: 'pointer' }}>LOST</button>
              </span>
            ) : (
              <span style={{
                flexShrink: 0, display: 'inline-block', borderRadius: 99, padding: '4px 12px',
                fontSize: 11, fontWeight: 700, fontFamily: FONT_BODY, color: '#fff',
                background: l.status === 'won' ? FREE_GREEN : LOST_BROWN,
              }}>{l.status.toUpperCase()}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
