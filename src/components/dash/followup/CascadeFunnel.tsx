import { FREE_GREEN, NUM_TABLE, brandVar } from '@/lib/theme';

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
            : `rgba(20,20,20,${(0.09 - i * 0.015).toFixed(3)})`;
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
