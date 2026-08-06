'use client';
import { Card } from './Card';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { FONT_BODY, CARD_FG, CARD_MUTED, FREE_GREEN, SCORE_RED } from '@/lib/theme';
import { GATED_ZONES, ZONE_LABELS, type ZoneId, type ZoneLock } from '@/lib/dash/locks';

/**
 * Setup completion, not performance.
 *
 * Shows a count of connected items. Never a percentage, score, streak, or any
 * speed measure: gamification in this product is limited to leads in and leads
 * closed, and response speed is excluded outright because the owner does not
 * control it.
 */
export function SetupChecklist({ locks }: { locks: Record<ZoneId, ZoneLock | null> }) {
  const connected = GATED_ZONES.filter((id) => locks[id] === null).length;

  return (
    <Card label="SETUP">
      <div style={{
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700,
        color: CARD_FG, marginTop: 8,
      }}>
        {connected} of {GATED_ZONES.length} connected
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 11 }}>
        {GATED_ZONES.map((id) => {
          const lock = locks[id];
          const done = lock === null;
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {done
                ? <CheckCircle size={16} weight="fill" color={FREE_GREEN} />
                : <Circle size={16} weight="bold" color={SCORE_RED} />}
              <span style={{
                fontFamily: FONT_BODY, fontSize: 12,
                color: done ? CARD_MUTED : CARD_FG,
              }}>
                {ZONE_LABELS[id]}
              </span>
              {!done && lock?.cta && (
                <a href={lock.cta.href} style={{
                  marginLeft: 'auto', fontFamily: FONT_BODY, fontSize: 11.5,
                  fontWeight: 600, color: CARD_FG, textDecoration: 'underline',
                }}>
                  {lock.cta.label}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
