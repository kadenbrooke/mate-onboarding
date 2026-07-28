import type { Brand } from "./research/website"

export function brandToCssVars(brand: Brand): Record<string, string> {
  return {
    "--mate-primary": brand.colors.primary,
    "--mate-bg": brand.colors.bg,
    "--mate-accent": brand.colors.accent,
  }
}

// ---------------------------------------------------------------------------
// Dash light theme (2026-07 redesign) -- warm off-white canvas, light grey
// section cards, white stat sub-cards, exactly one dark accent card per page.
// The onboarding/demo surfaces keep the dark shell (--mate-bg); these tokens
// are the dashboard's own system.
// ---------------------------------------------------------------------------

/** Won / free / success -- darkened for contrast on white */
export const FREE_GREEN = '#2e8f5a';
/** Lost -- warm clay brown, legible on white (was #5a4038 on dark) */
export const LOST_BROWN = '#9a6a50';
/** White stat sub-card background */
export const BG_CARD = '#ffffff';
/** Warm off-white page canvas */
export const BG_PAGE = '#dcd8d2';
/** Light grey section (zone) card background */
export const BG_SECTION = '#f0eeea';
/** The page's single dark accent card */
export const BG_DARK_CARD = '#1d1d1d';
/** Primary dark text on light surfaces */
export const TEXT_DARK = '#141414';
/** Muted secondary text */
export const TEXT_MUTED = '#6f6a63';
/** Faint tertiary text / disabled */
export const TEXT_FAINT = '#a29b91';
/** Inactive bars, ring tracks, muted chart fills (warm beige) */
export const TRACK_BEIGE = '#e5e0d8';
/** Hairline borders on light surfaces */
export const BORDER_SOFT = '#e6e1da';
/** Soft card shadow -- replaces the dark theme's neon glows */
export const CARD_SHADOW = '0 1px 2px rgba(20,20,20,0.04), 0 6px 16px rgba(20,20,20,0.06)';

/** Lead-score traffic light (>=80 green, 60-79 amber, <60 red) */
export const SCORE_GREEN = FREE_GREEN;
export const SCORE_AMBER = '#c08a0a';
export const SCORE_RED = '#c0392b';
export function scoreColor(score: number): string {
  if (score >= 80) return SCORE_GREEN;
  if (score >= 60) return SCORE_AMBER;
  return SCORE_RED;
}

export const brandVar = 'var(--brand-primary, #e14d1a)';

// ---------------------------------------------------------------------------
// Typography tokens -- sourced from departments/marketing/brand-typography.md
// ---------------------------------------------------------------------------

/** Syne 400 with ss04 -- headings and card labels (self-hosted woff2) */
export const FONT_HEAD = `'Syne', sans-serif`;
export const FONT_HEAD_FEATURE = '"ss04"';

/** DM Sans -- body copy, microcopy, eyebrow labels */
export const FONT_BODY = `'DM Sans', sans-serif`;

/** Geist -- all numeric displays.
 *  --font-num is injected by next/font/google Geist in layout.tsx.
 *  - Standalone display stat (hero number): pnum + weight 300
 *  - Columns / aligned rows (tables): tnum + weight 400 */
export const FONT_NUM = `var(--font-num, 'Geist', sans-serif)`;

/** Standalone display stat style: proportional numerals, Geist 300 */
export const NUM_DISPLAY: React.CSSProperties = {
  fontFamily: FONT_NUM,
  fontFeatureSettings: '"pnum" 1',
  fontWeight: 300,
};

/** Column / table aligned numerics: tabular numerals, Geist 400 */
export const NUM_TABLE: React.CSSProperties = {
  fontFamily: FONT_NUM,
  fontFeatureSettings: '"tnum" 1',
  fontWeight: 400,
};
