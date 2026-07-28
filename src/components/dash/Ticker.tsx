'use client';
import type { ClientEvent } from '@/lib/metrics/events';
import { FONT_BODY } from '@/lib/theme';

const AGENT_COLOR: Record<ClientEvent['agent'], string> = {
  first_responder: 'var(--brand-primary, #e14d1a)',
  reactivator: '#b586e8',
  cultivator: '#3aa76d',
  reputation: '#e1a54d',
};

export function Ticker({ events }: { events: ClientEvent[] }) {
  if (events.length === 0) return null;
  const items = events.slice(0, 12);
  return (
    <div style={{
      overflow: 'hidden', background: '#171717', borderRadius: 8,
      padding: '6px 0', position: 'relative',
    }}>
      <style>{`
        @keyframes ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ticker-track { animation: none !important; } }
      `}</style>
      <div className="ticker-track" style={{
        display: 'inline-flex', gap: 28, whiteSpace: 'nowrap', paddingLeft: 12,
        animation: `ticker-scroll ${Math.max(30, items.length * 5)}s linear infinite`,
        fontFamily: FONT_BODY,
      }}>
        {[...items, ...items].map((e, i) => (
          <span key={`${e.id}-${i}`} style={{ fontSize: 11, opacity: .85 }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: AGENT_COLOR[e.agent], marginRight: 6, verticalAlign: 'middle',
            }} />
            {e.message}
          </span>
        ))}
      </div>
    </div>
  );
}
