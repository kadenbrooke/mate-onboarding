'use client';
import { useEffect, useRef, useState } from 'react';

function useCountUp(target: number, ms = 1500) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3))); // cubic ease-out
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}

// >= $10,000 (1_000_000 cents) → "$38.2k"; below that plain dollars e.g. "$9,500"
// Verified: 3820000 cents = $38,200 → $38,200 / 1000 = 38.2 → "$38.2k"
const money = (cents: number) =>
  cents >= 1_000_000
    ? `$${(cents / 100_000).toFixed(1)}k`
    : `$${Math.round(cents / 100).toLocaleString()}`;

export function HeroStrip({ recoveredCents, roiMultiple, hoursSaved, actions }: {
  recoveredCents: number; roiMultiple: number; hoursSaved: number; actions: number;
}) {
  const rec = useCountUp(recoveredCents);
  const hrs = useCountUp(hoursSaved, 1200);
  const act = useCountUp(actions, 1200);
  const cell: React.CSSProperties = { background: '#1d1d1d', borderRadius: 10, padding: 14, textAlign: 'center' };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ ...cell, flex: 2, textAlign: 'left',
        background: 'linear-gradient(90deg, color-mix(in srgb, var(--brand-primary, #e14d1a) 22%, #1d1d1d), #1d1d1d)' }}>
        <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {money(rec)}<span style={{ fontSize: 12, opacity: .6 }}> recovered</span>
        </div>
        <div style={{ fontSize: 11, opacity: .6 }}>{roiMultiple.toFixed(1)}x what you pay</div>
      </div>
      <div style={{ ...cell, flex: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Math.round(hrs)}h</div>
        <div style={{ fontSize: 10, opacity: .6 }}>SAVED</div>
      </div>
      <div style={{ ...cell, flex: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Math.round(act)}</div>
        <div style={{ fontSize: 10, opacity: .6 }}>ACTIONS</div>
      </div>
    </div>
  );
}
