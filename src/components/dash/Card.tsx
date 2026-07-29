'use client';
import type { ReactNode } from 'react';
import {
  FONT_BODY, BG_SECTION, BORDER_SOFT, CARD_SHADOW, TEXT_MUTED,
  CARD_BG, CARD_FG, CARD_MUTED,
} from '@/lib/theme';
import { useCardTheme, CardModeStar, themeKeyFromLabel } from './cardTheme';

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
 * Card -- stat sub-card. Nested inside a SectionCard on desktop; sits directly
 * on the warm canvas in mobile stacks. Radius 16, soft shadow, no glow.
 * `label` is optional: zones suppress it on desktop when the surrounding
 * SectionCard already carries the zone label.
 *
 * Round-4: every card carries a star toggle (top-right corner) that
 * flips it between light (white bg / dark text) and dark (RecoveredCard
 * treatment). The mode is expressed as --card-* vars on the container;
 * widget internals consume the CARD_* tokens so both modes render correctly.
 * `themeKey` is the stable persistence id; it defaults to a slug of `label`
 * (widgets that suppress their label on desktop pass it explicitly so both
 * breakpoints share one stored mode).
 */
export function Card({ label, right, children, style, themeKey }: {
  label?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties;
  themeKey?: string;
}) {
  const key = themeKey ?? (label ? themeKeyFromLabel(label) : undefined);
  const { dark, vars, toggle } = useCardTheme(key);
  return (
    <section data-card-mode={dark ? 'dark' : 'light'} style={{
      borderRadius: 16, padding: 16, background: CARD_BG,
      boxShadow: CARD_SHADOW, color: CARD_FG, ...vars, ...style,
    }}>
      {(key || label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          {label
            ? /* Card label: DM Sans semibold eyebrow per brand typography guide */
              <div style={{ fontSize: 11, letterSpacing: 2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600, minWidth: 0 }}>{label}</div>
            : <span />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {right}
            {key && <CardModeStar dark={dark} onToggle={toggle} />}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}
