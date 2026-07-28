import { Card } from '../Card';
import { scoreStats } from '@/lib/metrics/leads';
import { brandVar, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

export function QualityGauge({ leads }: { leads: Lead[] }) {
  const { avg } = scoreStats(leads);
  // Semicircle: conic-gradient from 270deg (left) sweeping clockwise avg/100*180 degrees
  const sweepDeg = (avg / 100) * 180;

  return (
    <Card label="LEAD QUALITY">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 12 }}>
        {/* Semicircle wrapper: overflow hidden so only top half is visible */}
        <div style={{ width: 150, height: 80, overflow: 'hidden', position: 'relative' }}>
          {/* Outer conic-gradient circle - 270deg start, brand sweep, then #2a2a2a, then transparent for bottom half */}
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: '50%',
              background: `conic-gradient(from 270deg, ${brandVar} 0deg ${sweepDeg}deg, #2a2a2a ${sweepDeg}deg 180deg, transparent 180deg 360deg)`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
          {/* Inner circle cutout, offset 15px to sit centered within the outer ring */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: '#171717',
              position: 'absolute',
              top: 15,
              left: 15,
            }}
          />
        </div>
        {/* Score label: Geist 300 pnum for standalone display stat */}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 30, color: '#fff', ...NUM_DISPLAY }}>{avg}</span>
          <span style={{ fontSize: 11, opacity: 0.5, fontFamily: FONT_BODY }}>avg</span>
        </div>
      </div>
    </Card>
  );
}
