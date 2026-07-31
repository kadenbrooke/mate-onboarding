import type { Brand } from "./research/website"

// House orange/cream scheme, matching the demo session's picked colors. A
// client who has not reached the color-pick step in onboarding yet has no
// brand of their own, so they get ours rather than an anonymous grey/blue.
//
// Deliberately NOT imported from ./research/website (whose DEFAULT_COLORS is
// the neutral scraper fallback, a different concept): that module is
// server-only (cheerio/sharp), and theme.ts is pulled into client components,
// so a value import would drag the scraping stack into the browser bundle.
// The `Brand` import above is type-only and erases at compile.
const FALLBACK_COLORS = {
  primary: "#e14d1a",
  bg: "#141414",
  accent: "#ec805b",
} as const

// A session whose onboarding never reached the color-pick step stores `brand`
// as `{}`, so `brand.colors` is undefined. Reading through it threw and took
// the whole dash layout down with a 500 -- an incomplete brand should degrade
// to neutral colors, not deny the client their dashboard.
export function brandToCssVars(brand: Brand | null | undefined): Record<string, string> {
  const colors = brand?.colors ?? FALLBACK_COLORS
  return {
    "--mate-primary": colors.primary ?? FALLBACK_COLORS.primary,
    "--mate-bg": colors.bg ?? FALLBACK_COLORS.bg,
    "--mate-accent": colors.accent ?? FALLBACK_COLORS.accent,
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
// Per-card light/dark theming (round-4 founder pass).
// Card containers (Card, RecoveredCard, HeroCard) set the --card-* custom
// properties for their mode; widget internals consume the CARD_* tokens below
// so every widget renders correctly in both modes. Fallbacks equal the light
// palette, so content rendered outside a themed card is unchanged.
// Brand orange, FREE_GREEN, score colors, and the source palette are
// intentionally NOT var-swapped: they read fine on both surfaces.
// ---------------------------------------------------------------------------

/** Dark-mode card palette literals (the RecoveredCard treatment) */
export const DARK_CARD_FG = '#ede6e6';
export const DARK_CARD_MUTED = 'rgba(237,230,230,0.65)';
export const DARK_CARD_FAINT = 'rgba(237,230,230,0.45)';
export const DARK_CARD_HAIRLINE = 'rgba(237,230,230,0.16)';
export const DARK_CARD_TRACK = 'rgba(237,230,230,0.18)';
export const DARK_CARD_CHIP = 'rgba(255,255,255,0.1)';
export const DARK_CARD_INSET = 'rgba(255,255,255,0.07)';
/** Light-mode chip bg (readouts, delta pills) */
export const LIGHT_CARD_CHIP = 'rgba(20,20,20,0.06)';

/** Card surface background (white light / #1d1d1d dark) */
export const CARD_BG = `var(--card-bg, ${BG_CARD})`;
/** Primary text inside a card */
export const CARD_FG = `var(--card-fg, ${TEXT_DARK})`;
/** Muted secondary text inside a card */
export const CARD_MUTED = `var(--card-muted, ${TEXT_MUTED})`;
/** Faint tertiary text inside a card */
export const CARD_FAINT = `var(--card-faint, ${TEXT_FAINT})`;
/** Hairline borders inside a card */
export const CARD_HAIRLINE = `var(--card-hairline, ${BORDER_SOFT})`;
/** Ring tracks / inactive bars inside a card */
export const CARD_TRACK = `var(--card-track, ${TRACK_BEIGE})`;
/** Subtle chip/readout background inside a card */
export const CARD_CHIP = `var(--card-chip, ${LIGHT_CARD_CHIP})`;
/** Inset panel background inside a card (calendar cells, sub-panels) */
export const CARD_INSET = `var(--card-inset, ${BG_SECTION})`;

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
