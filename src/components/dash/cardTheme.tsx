'use client';
import { useCallback, useEffect, useState } from 'react';
import { Star } from '@phosphor-icons/react';
import {
  BG_CARD, BG_DARK_CARD, TEXT_DARK, TEXT_MUTED, TEXT_FAINT, BORDER_SOFT,
  TRACK_BEIGE, BG_SECTION, LIGHT_CARD_CHIP,
  DARK_CARD_FG, DARK_CARD_MUTED, DARK_CARD_FAINT, DARK_CARD_HAIRLINE,
  DARK_CARD_TRACK, DARK_CARD_CHIP, DARK_CARD_INSET,
  CARD_FAINT, brandVar,
} from '@/lib/theme';

// Per-card light/dark toggle (round-4 founder pass). Each small stat card
// carries a star button at its top-left; clicking flips THAT card between the
// white light treatment and the dark RecoveredCard treatment. Mode persists
// per card in localStorage, keyed by a stable card id.

const STORAGE_PREFIX = 'mate-card-theme:';
/** Same-tab sync: HeroStrip renders twice (desktop + mobile stacks), so the
 *  hidden duplicate must follow a toggle without a remount. */
const SYNC_EVENT = 'mate-card-theme';

/** Stable localStorage key from a card label ("HOT RIGHT NOW" -> "hot-right-now"). */
export function themeKeyFromLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The full --card-* var set for one mode. Every widget internal reads these
 *  (via the CARD_* tokens in theme.ts), so flipping the container restyles
 *  text, tracks, hairlines, chips, and inset panels together. */
export function cardThemeVars(dark: boolean): React.CSSProperties {
  return (dark ? {
    '--card-bg': BG_DARK_CARD,
    '--card-fg': DARK_CARD_FG,
    '--card-muted': DARK_CARD_MUTED,
    '--card-faint': DARK_CARD_FAINT,
    '--card-hairline': DARK_CARD_HAIRLINE,
    '--card-track': DARK_CARD_TRACK,
    '--card-chip': DARK_CARD_CHIP,
    '--card-inset': DARK_CARD_INSET,
  } : {
    '--card-bg': BG_CARD,
    '--card-fg': TEXT_DARK,
    '--card-muted': TEXT_MUTED,
    '--card-faint': TEXT_FAINT,
    '--card-hairline': BORDER_SOFT,
    '--card-track': TRACK_BEIGE,
    '--card-chip': LIGHT_CARD_CHIP,
    '--card-inset': BG_SECTION,
  }) as React.CSSProperties;
}

export function useCardTheme(key: string | undefined, defaultDark = false) {
  // SSR-safe: first render always uses the default; localStorage is read in
  // an effect so server and client markup never disagree.
  const [dark, setDark] = useState(defaultDark);

  useEffect(() => {
    if (!key) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + key);
      if (stored === 'dark') setDark(true);
      else if (stored === 'light') setDark(false);
    } catch { /* storage unavailable (private mode): session-only toggle */ }
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; dark: boolean }>).detail;
      if (detail?.key === key) setDark(detail.dark);
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [key]);

  const toggle = useCallback(() => {
    // Side effects (storage + sync event) stay OUTSIDE the state updater:
    // dispatching inside setDark triggers the sibling instance's setState
    // mid-render (React warning, fragile under concurrent rendering).
    const next = !dark;
    setDark(next);
    if (key) {
      try { window.localStorage.setItem(STORAGE_PREFIX + key, next ? 'dark' : 'light'); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, dark: next } })); } catch { /* ignore */ }
    }
  }, [key, dark]);

  return { dark, vars: cardThemeVars(dark), toggle };
}

/** Star toggle: filled when the card is dark, outline when light. The
 *  .dash-star class (dash layout) extends the hit area to >=44px. */
export function CardModeStar({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="dash-star"
      aria-pressed={dark}
      aria-label={dark ? 'Switch card to light mode' : 'Switch card to dark mode'}
      onClick={onToggle}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        color: dark ? brandVar : CARD_FAINT,
      }}
    >
      <Star size={13} weight={dark ? 'fill' : 'regular'} aria-hidden />
    </button>
  );
}
