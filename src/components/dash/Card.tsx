import type { ReactNode } from 'react';
import {
  FONT_BODY, BG_CARD, BG_SECTION, BORDER_SOFT, CARD_SHADOW, TEXT_DARK, TEXT_MUTED,
} from '@/lib/theme';

/**
 * SectionCard -- large light-grey rounded card that groups one dashboard zone.
 * Holds white stat sub-cards (Card) inside. Radius 24 per the light redesign.
 * Every section carries a short eyebrow label (11px DM Sans semibold), same
 * treatment as the white Card labels so the page reads as one system.
 * `id` doubles as the icon-rail scroll anchor.
 */
export function SectionCard({ title, right, children, style, id }: {
  title?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties; id?: string;
}) {
  return (
    <section id={id} style={{
      background: BG_SECTION, borderRadius: 24, padding: 16,
      border: `1px solid ${BORDER_SOFT}`, scrollMarginTop: 12, ...style,
    }}>
      {(title || right) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '2px 6px 10px',
        }}>
          {title
            ? <h2 style={{
                margin: 0, fontSize: 11, letterSpacing: 2, color: TEXT_MUTED,
                fontFamily: FONT_BODY, fontWeight: 600, textTransform: 'uppercase',
              }}>{title}</h2>
            : <span />}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Card -- white stat sub-card. Nested inside a SectionCard on desktop; sits
 * directly on the warm canvas in mobile stacks. Radius 16, soft shadow, no glow.
 * `label` is optional: zones suppress it on desktop when the surrounding
 * SectionCard already carries the zone label.
 */
export function Card({ label, right, children, style }: {
  label?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{
      borderRadius: 16, padding: 16, background: BG_CARD,
      boxShadow: CARD_SHADOW, color: TEXT_DARK, ...style,
    }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {/* Card label: DM Sans semibold eyebrow per brand typography guide */}
          <div style={{ fontSize: 11, letterSpacing: 2, color: TEXT_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>{label}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
