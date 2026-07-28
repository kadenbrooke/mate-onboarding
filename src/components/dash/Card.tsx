import type { ReactNode } from 'react';

export function Card({ label, right, children, style }: {
  label: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{
      border: '1px solid #2a2a2a', borderRadius: 14, padding: 16,
      background: 'linear-gradient(180deg,#1a1a1a,#141414)', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.55 }}>{label}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
