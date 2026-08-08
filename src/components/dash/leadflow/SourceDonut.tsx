import { Card } from '../Card';
import { sourceBreakdown } from '@/lib/metrics/leads';
import { RingStat } from '../RingStat';
import { SOURCE_COLORS, SOURCE_LABELS } from '@/lib/metrics/colors';
import { FREE_GREEN } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

export function SourceDonut({ leads }: { leads: Lead[] }) {
  const { segments, freeCount } = sourceBreakdown(leads);

  return (
    <Card label="SOURCE">
      <div style={{ marginTop: 12 }}>
        <RingStat
          idPrefix="source"
          segments={segments.map(s => ({
            key: s.source,
            label: SOURCE_LABELS[s.source] ?? s.source,
            value: s.count,
            color: SOURCE_COLORS[s.source] ?? SOURCE_COLORS.unknown,
          }))}
          // Resting center is the FREE count -- an aggregate across the free
          // sources, not a single segment. Hovering a source swaps to it.
          center={{ label: 'FREE', display: String(freeCount), color: FREE_GREEN }}
          ariaLabel={`${freeCount} free leads across ${segments.length} sources`}
        />
      </div>
    </Card>
  );
}
