import { FREE_GREEN, NUM_TABLE } from '@/lib/theme';

export type CascadeStage = { label: string; count: number; highlight?: 'green' | 'brand' };

// Command-center cascade: full-width top row, each stage narrower + indented,
// terminal stage glows. Reused by Follow-up and Reputation zones.
// Widths are narrative tiers (100% → 40% linear), not count-proportional — counts carry the data.
export function CascadeFunnel({ stages }: { stages: CascadeStage[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {stages.map((s, i) => {
        const width = stages.length === 1 ? 100 : 100 - (i * (60 / (stages.length - 1)));
        const indent = (100 - width) / 2;
        const bg = s.highlight === 'green'
          ? `linear-gradient(90deg, #2e8b57, ${FREE_GREEN})`
          : s.highlight === 'brand'
            ? 'linear-gradient(90deg, #8a2f0f, var(--brand-primary, #e14d1a))'
            : `rgba(255,255,255,${0.16 - i * 0.03})`;
        return (
          <div key={s.label} style={{
            width: `${width}%`, marginLeft: `${indent}%`,
            background: bg, borderRadius: 7, padding: '7px 12px',
            display: 'flex', justifyContent: 'space-between', fontSize: 11,
            boxShadow: s.highlight ? `0 0 12px ${s.highlight === 'green' ? FREE_GREEN : 'var(--brand-primary, #e14d1a)'}44` : undefined,
          }}>
            <span>{s.label}</span>
            <b style={{ ...NUM_TABLE }}>{s.count}</b>
          </div>
        );
      })}
    </div>
  );
}
