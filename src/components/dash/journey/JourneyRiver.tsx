import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { Lead } from '@/lib/metrics/leads';
import { journeyRiver } from '@/lib/metrics/journey';
import { moneyShort } from '@/lib/metrics/format';
import { Card } from '../Card';
import { STAGE_COLOR, FONT_BODY, CARD_MUTED, CARD_TRACK, CARD_HAIRLINE } from '@/lib/theme';

// d3-sankey layout over: Quoted -> Won / Still open / Lost. Source-level
// detail (web form, missed call, etc.) now lives entirely in the Source
// donut below this card, so the river stays a single at-a-glance split
// instead of a source-by-source breakdown. Runs server-side (pure math, no
// hooks). Nodes are rounded rects tinted for the light theme.
//
// Two SVG variants (desktop 640u / mobile 360u viewBox), CSS-toggled at 640px:
// a single viewBox stretched to a ~360px phone scales 10-unit text down to
// ~5px rendered, which was unreadable. The narrower mobile viewBox keeps
// rendered text at ~9px.

type NodeExtra = { id: string; label: string; color: string; kind: 'priced' | 'open' | 'booked' | 'quoted' | 'serviced' };
type LinkExtra = { color: string };

type RiverGeometry = {
  /** viewBox width/height */
  w: number; h: number;
  /** sankey extent: label gutters left/right of the ribbons */
  left: number; right: number;
};

// No source column anymore: Quoted is the leftmost node with only a small
// gutter for its top-side label, so the whole diagram reads as one clean
// split rather than a wide multi-column flow.
const DESKTOP: RiverGeometry = { w: 480, h: 140, left: 20, right: 150 };
const MOBILE: RiverGeometry = { w: 300, h: 140, left: 16, right: 120 };

function RiverSvg({ nodes, links, geo, variant }: {
  nodes: NodeExtra[];
  links: { source: string; target: string; value: number; color: string }[];
  geo: RiverGeometry;
  variant: 'desktop' | 'mobile';
}) {
  const layout = sankey<NodeExtra, LinkExtra>()
    .nodeId(d => d.id)
    .nodeWidth(10)
    .nodePadding(14)
    .nodeSort(null) // keep Won / Still open / Lost in that fixed order
    .extent([[geo.left, 12], [geo.w - geo.right, geo.h - 12]]);

  const graph = layout({
    nodes: nodes.map(n => ({ ...n })),
    links: links.map(l => ({ ...l })),
  });

  const linkPath = sankeyLinkHorizontal();

  return (
    <svg
      className={`jr-${variant}`}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible', marginTop: 8 }}
      aria-hidden="true"
    >
      {/* Links: outcome-colored ribbons */}
      {graph.links.map((l, i) => (
        <path
          key={`link-${i}`}
          d={linkPath(l) ?? undefined}
          fill="none"
          stroke={l.color}
          strokeOpacity={0.45}
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
            fill={n.kind === 'priced' ? CARD_TRACK : n.color}
            stroke={n.kind === 'priced' ? CARD_HAIRLINE : 'none'}
          />
          {n.kind === 'priced' && (
            <text
              x={((n.x0 ?? 0) + (n.x1 ?? 0)) / 2}
              y={(n.y0 ?? 0) - 7}
              textAnchor="middle"
              fontSize={10}
              fontFamily={FONT_BODY}
              fontWeight={700}
              fill={CARD_MUTED}
            >
              {n.label}
            </text>
          )}
          {n.kind !== 'priced' && (
            <text
              x={(n.x1 ?? 0) + 8}
              y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
              dominantBaseline="middle"
              fontSize={10}
              fontFamily={FONT_BODY}
              fontWeight={700}
              fill={n.color}
            >
              {n.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function JourneyRiver({ leads, showLabel = true }: { leads: Lead[]; showLabel?: boolean }) {
  const river = journeyRiver(leads);
  // Desktop suppresses the card label: the surrounding SectionCard carries it.
  const label = showLabel ? 'LEAD JOURNEY' : undefined;

  // Empty state
  if (river.total === 0) {
    return (
      <Card label={label} themeKey="lead-journey">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 150, fontSize: 12, color: CARD_MUTED, fontFamily: FONT_BODY,
        }}>
          Your leads will flow here as they come in
        </div>
      </Card>
    );
  }

  const nodes: NodeExtra[] = [{ id: 'priced', label: `Priced ${river.priced}`, color: '#8a8378', kind: 'priced' }];
  const links: { source: string; target: string; value: number; color: string }[] = [];

  // One branch per pipeline stage. A zero-count stage is omitted entirely so
  // the river never renders an empty slice.
  const branches = [
    { kind: 'open' as const, count: river.open, label: `Still open ${river.open}` },
    { kind: 'booked' as const, count: river.booked, label: `Booked ${river.booked}` },
    { kind: 'quoted' as const, count: river.quoted, label: `Quoted ${river.quoted}` },
    { kind: 'serviced' as const, count: river.serviced, label: `Serviced ${river.serviced} · ${moneyShort(river.servicedCents)}` },
  ];
  for (const b of branches) {
    if (b.count <= 0) continue;
    const color = STAGE_COLOR[b.kind];
    nodes.push({ id: b.kind, label: b.label, color, kind: b.kind });
    links.push({ source: 'priced', target: b.kind, value: b.count, color });
  }

  return (
    <Card label={label} themeKey="lead-journey">
      <style>{`
        @media (max-width: 640px) { .jr-desktop { display: none !important; } }
        @media (min-width: 641px) { .jr-mobile { display: none !important; } }
      `}</style>
      <RiverSvg nodes={nodes} links={links} geo={DESKTOP} variant="desktop" />
      <RiverSvg nodes={nodes} links={links} geo={MOBILE} variant="mobile" />
    </Card>
  );
}
