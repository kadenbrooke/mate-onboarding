'use client';
import { Hourglass } from '@phosphor-icons/react';
import { FONT_BODY, TEXT_MUTED, TEXT_FAINT, BORDER_SOFT } from '@/lib/theme';

/**
 * The body a locked SectionCard renders in place of its children when the
 * lock's kind is 'coming-soon': a feature that is not live for any client
 * yet, so there is nothing for this client to do about it.
 *
 * Deliberately the anti-MissingInfo: muted grey rather than red (red reads as
 * an error, and a future feature is not one), no CTA (there is no action to
 * take), and no numbers of any kind, same guarantee MissingInfo carries --
 * this is a presentational cover only and never needs the real zone data,
 * which is already stripped server-side by gateLockedZoneData either way.
 */
export function ComingSoon({ zoneLabel, description }: {
  zoneLabel: string;
  description: string;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: 10,
      padding: '26px 6px', minHeight: 180,
    }}>
      <Hourglass size={22} weight="regular" color={TEXT_FAINT} aria-hidden />
      <div style={{
        fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10, letterSpacing: 1.5,
        textTransform: 'uppercase', color: TEXT_MUTED,
        background: BORDER_SOFT, borderRadius: 999, padding: '4px 12px',
      }}>
        Coming soon
      </div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: TEXT_MUTED }}>
        {zoneLabel}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT_FAINT, maxWidth: '34ch' }}>
        {description}
      </div>
    </div>
  );
}
