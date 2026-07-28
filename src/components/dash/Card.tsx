import type { ReactNode } from 'react';
import { FONT_BODY } from '@/lib/theme';

export function Card({ label, right, children, style }: {
  label: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{
      border: '1px solid #2a2a2a', borderRadius: 14, padding: 16,
      background: 'linear-gradient(180deg,#1a1a1a,#141414)', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {/* Card label: DM Sans semibold eyebrow per brand typography guide */}
        <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.55, fontFamily: FONT_BODY, fontWeight: 600 }}>{label}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
