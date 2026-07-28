import type { Lead } from '@/lib/metrics/leads';
import { journeyRiver } from '@/lib/metrics/journey';
import { moneyShort } from '@/lib/metrics/format';
import { Card } from '../Card';
import { brandVar, FREE_GREEN, FONT_BODY } from '@/lib/theme';

// Source label humanization (mirrors SourceDonut SOURCE_LABELS)
const SOURCE_LABELS: Record<string, string> = {
  missed_call: 'Missed call',
  texted_in: 'Texted in',
  web_form: 'Web form',
  referral: 'Referral',
  revived: 'Revived',
  unknown: 'Other',
};

// Darker shade of FREE_GREEN for wide fills (bands and ribbons)
const FREE_BAND_GREEN = '#2e8b57';
const GRAY_RAMP = ['#555', '#777', '#999', '#444', '#333'];

export function JourneyRiver({ leads }: { leads: Lead[] }) {
  const river = journeyRiver(leads);

  // Empty state
  if (river.total === 0) {
    return (
      <Card label="LEAD JOURNEY">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 150,
          fontSize: 12,
          opacity: 0.5,
          fontFamily: FONT_BODY,
        }}>
          Your leads will flow here as they come in
        </div>
      </Card>
    );
  }

  // Band layout constants
  const DRAWABLE_H = 120;
  const GAP = 8;
  const MIN_BAND = 8;
  const LEFT_X = 80;
  const MID_X = 300;
  const RIGHT_X = 560;
  const TOP_OFFSET = 15; // vertical centering within 150px viewBox

  // Take top 4 sources; aggregate the rest into "Other N"
  const sorted = river.sources; // already sorted by count desc from journeyRiver
  const TOP_N = 4;
  const topSources = sorted.slice(0, TOP_N);
  const overflow = sorted.slice(TOP_N);

  type RawSource = { source: string; count: number; free: boolean };
  const allSources: RawSource[] = [...topSources];
  if (overflow.length > 0) {
    const otherCount = overflow.reduce((a, s) => a + s.count, 0);
    allSources.push({ source: '__other__', count: otherCount, free: false });
  }

  // Normalize band heights against the FULL total (river.total)
  const totalCount = river.total;
  const n = allSources.length;

  // Compute band heights proportional to count, respecting min and total drawable
  const gapsTotal = (n - 1) * GAP;
  const availH = DRAWABLE_H - gapsTotal;

  let rawHeights = allSources.map(s => Math.max(MIN_BAND, (s.count / Math.max(totalCount, 1)) * availH));
  // Scale so total doesn't exceed available
  const rawSum = rawHeights.reduce((a, b) => a + b, 0);
  if (rawSum > availH) {
    const scale = availH / rawSum;
    rawHeights = rawHeights.map(h => Math.max(MIN_BAND, h * scale));
  }

  // Compute top Y for each band
  const totalUsed = rawHeights.reduce((a, b) => a + b, 0) + gapsTotal;
  const startY = TOP_OFFSET + (DRAWABLE_H - totalUsed) / 2;

  type Band = {
    source: string;
    count: number;
    free: boolean;
    y: number;
    h: number;
    color: string;
    label: string;
  };

  const bands: Band[] = [];
  let curY = startY;
  let grayIdx = 0;
  for (let i = 0; i < allSources.length; i++) {
    const s = allSources[i];
    const h = rawHeights[i];
    let color: string;
    if (s.source === '__other__') {
      color = '#444';
    } else {
      color = s.free ? FREE_BAND_GREEN : GRAY_RAMP[grayIdx++ % GRAY_RAMP.length];
    }
    const label = s.source === '__other__'
      ? `Other ${overflow.length}`
      : (SOURCE_LABELS[s.source] ?? s.source);
    bands.push({ source: s.source, count: s.count, free: s.free, y: curY, h, color, label });
    curY += h + GAP;
  }

  // Middle node (quoted band) centered
  const midCenterY = startY + totalUsed / 2;
  const quotedBandH = Math.max(MIN_BAND, (river.quoted / Math.max(river.total, 1)) * DRAWABLE_H);
  const midTopY = midCenterY - quotedBandH / 2;
  const midBotY = midCenterY + quotedBandH / 2;

  // Right column: won block above, open below
  const wonH = river.quoted > 0 ? Math.max(MIN_BAND, (river.won / Math.max(river.quoted, 1)) * quotedBandH) : MIN_BAND;
  const openH = river.quoted > 0 ? Math.max(MIN_BAND, (river.open / Math.max(river.quoted, 1)) * quotedBandH) : MIN_BAND;
  const rightTotalH = wonH + (river.won > 0 && river.open > 0 ? GAP : 0) + openH;
  const rightStartY = midCenterY - rightTotalH / 2;
  const wonTopY = rightStartY;
  const wonBotY = rightStartY + wonH;
  const openTopY = rightStartY + wonH + (river.won > 0 && river.open > 0 ? GAP : 0);
  const openBotY = openTopY + openH;

  // Build a filled bezier ribbon path: source band -> mid node
  // Top curve: M x1,topY1 C midX,topY1 midX,topY2 x2,topY2
  // Line down right edge, bottom curve back, Z
  function ribbonPath(
    x1: number, topY1: number, botY1: number,
    x2: number, topY2: number, botY2: number,
  ): string {
    const cx = (x1 + x2) / 2;
    return [
      `M ${x1},${topY1}`,
      `C ${cx},${topY1} ${cx},${topY2} ${x2},${topY2}`,
      `L ${x2},${botY2}`,
      `C ${cx},${botY2} ${cx},${botY1} ${x1},${botY1}`,
      'Z',
    ].join(' ');
  }

  // Destination cursor: each band gets a proportional slice of the quoted node height,
  // stacked top to bottom in band order so ribbons fan out without overlapping.
  let midCurY = midTopY;

  return (
    <Card label="LEAD JOURNEY">
      <svg
        viewBox="0 0 640 150"
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* Source band ribbons to quoted node - each gets a proportional dest slice */}
        {bands.map((band) => {
          const dstH = (band.count / totalCount) * quotedBandH;
          const dstTop = midCurY;
          const dstBot = midCurY + dstH;
          midCurY = dstBot;
          return (
            <path
              key={`ribbon-${band.source}`}
              data-ribbon="true"
              d={ribbonPath(LEFT_X + 40, band.y, band.y + band.h, MID_X - 4, dstTop, dstBot)}
              fill={band.color}
              opacity={0.8}
            />
          );
        })}

        {/* Quoted -> Won ribbon */}
        {river.won > 0 && (
          <path
            d={ribbonPath(MID_X + 4, midTopY, midTopY + wonH, RIGHT_X - 4, wonTopY, wonBotY)}
            fill={FREE_GREEN}
            opacity={0.85}
            style={{ filter: `drop-shadow(0 0 4px ${FREE_GREEN})` }}
          />
        )}

        {/* Quoted -> Open ribbon */}
        {river.open > 0 && (
          <path
            d={ribbonPath(MID_X + 4, midBotY - openH, midBotY, RIGHT_X - 4, openTopY, openBotY)}
            fill={brandVar}
            opacity={0.6}
          />
        )}

        {/* Source bands (left) */}
        {bands.map((band) => (
          <g key={`band-${band.source}`}>
            <rect
              x={LEFT_X - 36}
              y={band.y}
              width={40}
              height={band.h}
              rx={2}
              fill={band.color}
            />
            {/* Source label left of band */}
            <text
              x={LEFT_X - 40}
              y={band.y + band.h / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={9}
              fontFamily={FONT_BODY}
              fill={band.free ? FREE_BAND_GREEN : '#aaa'}
            >
              {band.label} {band.count}
            </text>
          </g>
        ))}

        {/* Middle quoted node */}
        <rect
          x={MID_X - 4}
          y={midTopY}
          width={8}
          height={quotedBandH}
          rx={2}
          fill="#444"
        />
        <text
          x={MID_X}
          y={midTopY - 6}
          textAnchor="middle"
          fontSize={10}
          fontFamily={FONT_BODY}
          fontWeight={700}
          fill="#ccc"
        >
          {`Quoted ${river.quoted}`}
        </text>

        {/* Right outcomes */}
        {river.won > 0 && (
          <>
            <rect
              x={RIGHT_X - 4}
              y={wonTopY}
              width={8}
              height={wonH}
              rx={2}
              fill={FREE_GREEN}
            />
            <text
              x={RIGHT_X + 8}
              y={wonTopY + wonH / 2}
              dominantBaseline="middle"
              fontSize={10}
              fontFamily={FONT_BODY}
              fontWeight={700}
              fill={FREE_GREEN}
            >
              {`Won ${river.won} · ${moneyShort(river.wonCents)}`}
            </text>
          </>
        )}

        {river.open > 0 && (
          <>
            <rect
              x={RIGHT_X - 4}
              y={openTopY}
              width={8}
              height={openH}
              rx={2}
              fill="#555"
            />
            <text
              x={RIGHT_X + 8}
              y={openTopY + openH / 2}
              dominantBaseline="middle"
              fontSize={9}
              fontFamily={FONT_BODY}
              fill="#8a8a8a"
            >
              {`Still open ${river.open}`}
            </text>
          </>
        )}
      </svg>
    </Card>
  );
}
