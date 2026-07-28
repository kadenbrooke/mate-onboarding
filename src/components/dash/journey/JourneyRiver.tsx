import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { Lead } from '@/lib/metrics/leads';
import { journeyRiver } from '@/lib/metrics/journey';
import { moneyShort } from '@/lib/metrics/format';
import { SOURCE_COLORS, SOURCE_LABELS } from '@/lib/metrics/colors';
import { Card } from '../Card';
import { brandVar, FREE_GREEN, FONT_BODY, TEXT_MUTED, TRACK_BEIGE } from '@/lib/theme';

// d3-sankey layout over: sources -> Quoted -> Won / Still open.
// Runs server-side (pure math, no hooks). Links are source-colored ribbons at
// low opacity; nodes are rounded rects tinted for the light theme.

type NodeExtra = { id: string; label: string; color: string; kind: 'source' | 'quoted' | 'won' | 'open' };
type LinkExtra = { color: string; ribbon: boolean };

const W = 640;
const H = 170;

export function JourneyRiver({ leads }: { leads: Lead[] }) {
  const river = journeyRiver(leads);

  // Empty state
  if (river.total === 0) {
    return (
      <Card label="LEAD JOURNEY">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 150, fontSize: 12, color: TEXT_MUTED, fontFamily: FONT_BODY,
        }}>
          Your leads will flow here as they come in
        </div>
      </Card>
    );
  }

  const nodes: NodeExtra[] = [];
  const links: { source: string; target: string; value: number; color: string; ribbon: boolean }[] = [];

  for (const s of river.sources) {
    if (s.count <= 0) continue;
    const color = SOURCE_COLORS[s.source] ?? SOURCE_COLORS.unknown;
    nodes.push({ id: `src-${s.source}`, label: `${SOURCE_LABELS[s.source] ?? s.source} ${s.count}`, color, kind: 'source' });
    links.push({ source: `src-${s.source}`, target: 'quoted', value: s.count, color, ribbon: true });
  }
  nodes.push({ id: 'quoted', label: `Quoted ${river.quoted}`, color: '#8a8378', kind: 'quoted' });
  if (river.won > 0) {
    nodes.push({ id: 'won', label: `Won ${river.won} · ${moneyShort(river.wonCents)}`, color: FREE_GREEN, kind: 'won' });
    links.push({ source: 'quoted', target: 'won', value: river.won, color: FREE_GREEN, ribbon: false });
  }
  if (river.open > 0) {
    nodes.push({ id: 'open', label: `Still open ${river.open}`, color: brandVar, kind: 'open' });
    links.push({ source: 'quoted', target: 'open', value: river.open, color: brandVar, ribbon: false });
  }

  const layout = sankey<NodeExtra, LinkExtra>()
    .nodeId(d => d.id)
    .nodeWidth(10)
    .nodePadding(14)
    .nodeSort(null) // keep count-desc input order from journeyRiver
    .extent([[120, 12], [W - 140, H - 12]]);

  const graph = layout({
    nodes: nodes.map(n => ({ ...n })),
    links: links.map(l => ({ ...l })),
  });

  const linkPath = sankeyLinkHorizontal();

  return (
    <Card label="LEAD JOURNEY">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible', marginTop: 8 }}
        aria-hidden="true"
      >
        {/* Links: source-colored ribbons at low opacity */}
        {graph.links.map((l, i) => (
          <path
            key={`link-${i}`}
            data-ribbon={l.ribbon ? 'true' : undefined}
            d={linkPath(l) ?? undefined}
            fill="none"
            stroke={l.color}
            strokeOpacity={l.ribbon ? 0.3 : 0.45}
            strokeWidth={Math.max(1, l.width ?? 1)}
          />
        ))}

        {/* Nodes: rounded rects */}
        {graph.nodes.map(n => (
          <g key={n.id}>
            <rect
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0))}
              rx={4}
              fill={n.kind === 'quoted' ? TRACK_BEIGE : n.color}
              stroke={n.kind === 'quoted' ? '#d8d2c8' : 'none'}
            />
            {n.kind === 'source' && (
              <text
                x={(n.x0 ?? 0) - 8}
                y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fontFamily={FONT_BODY}
                fill={n.color}
                fontWeight={600}
              >
                {n.label}
              </text>
            )}
            {n.kind === 'quoted' && (
              <text
                x={((n.x0 ?? 0) + (n.x1 ?? 0)) / 2}
                y={(n.y0 ?? 0) - 7}
                textAnchor="middle"
                fontSize={10}
                fontFamily={FONT_BODY}
                fontWeight={700}
                fill={TEXT_MUTED}
              >
                {n.label}
              </text>
            )}
            {(n.kind === 'won' || n.kind === 'open') && (
              <text
                x={(n.x1 ?? 0) + 8}
                y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                dominantBaseline="middle"
                fontSize={10}
                fontFamily={FONT_BODY}
                fontWeight={700}
                fill={n.kind === 'won' ? FREE_GREEN : brandVar}
              >
                {n.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </Card>
  );
}
