'use client';
import { WarningCircle } from '@phosphor-icons/react';
import { FONT_BODY, TEXT_DARK, TEXT_MUTED, BG_SECTION, SCORE_RED } from '@/lib/theme';
import type { ZoneCta } from '@/lib/dash/locks';

/**
 * The body a locked SectionCard renders instead of its children.
 *
 * Deliberately shows no numbers of any kind: no blurred sample figures, no
 * skeleton bars implying data. This dashboard had an incident where real and
 * synthetic leads were indistinguishable, and the lock state will not
 * reintroduce that ambiguity in visual form.
 *
 * SCORE_RED is the existing lead-score alert red, reused here rather than
 * adding a colour to the palette. The alert is an eyebrow tag, not a
 * headline: four of these can sit on one screen, and a 31px red block
 * repeated four times shouted louder than any real data on the page
 * (founder cosmetics pass, 2026-08-12). The tinted SectionCard already
 * signals the alert state; the cover's job is to name the fix.
 */
export function MissingInfo({ zoneLabel, reason, cta }: {
  zoneLabel: string;
  reason: string;
  cta?: ZoneCta;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: 9,
      padding: '22px 6px', minHeight: 180,
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11,
        letterSpacing: 1.5, color: SCORE_RED,
      }}>
        <WarningCircle size={14} weight="bold" aria-hidden />
        MISSING INFO
      </div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: TEXT_DARK }}>
        {zoneLabel}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT_MUTED, maxWidth: '31ch' }}>
        {reason}
      </div>
      {cta && (
        <a
          href={cta.href}
          style={{
            marginTop: 6, borderRadius: 999, padding: '10px 20px',
            fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
            ...(cta.secondary
              ? { background: 'transparent', color: TEXT_MUTED, border: `1px solid ${SCORE_RED}33` }
              : { background: TEXT_DARK, color: BG_SECTION, border: '1px solid transparent' }),
          }}
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}
