import { FREE_GREEN, NUM_TABLE, brandVar, CARD_FG } from '@/lib/theme';

export type CascadeStage = { label: string; count: number; highlight?: 'green' | 'brand' };

// Command-center cascade: full-width top row, each stage narrower + indented,
// terminal stage colored. Reused by Follow-up and Reputation zones.
// Widths are narrative tiers (100% → 40% linear), not count-proportional - counts carry the data.
export function CascadeFunnel({ stages }: { stages: CascadeStage[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {stages.map((s, i) => {
        const width = stages.length === 1 ? 100 : 100 - (i * (60 / (stages.length - 1)));
        const indent = (100 - width) / 2;
        const bg = s.highlight === 'green'
          ? FREE_GREEN
          : s.highlight === 'brand'
            ? brandVar
            : `color-mix(in srgb, ${CARD_FG} ${(9 - i * 1.5).toFixed(1)}%, transparent)`;
        return (
          <div key={s.label} style={{
            width: `${width}%`, marginLeft: `${indent}%`,
            background: bg, borderRadius: 99, padding: '7px 12px',
            color: s.highlight ? '#ffffff' : 'inherit',
            display: 'flex', justifyContent: 'space-between', fontSize: 11,
          }}>
            <span>{s.label}</span>
            <b style={{ ...NUM_TABLE }}>{s.count}</b>
          </div>
        );
      })}
    </div>
  );
}
