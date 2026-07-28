import type { Brand } from "./research/website"

export function brandToCssVars(brand: Brand): Record<string, string> {
  return {
    "--mate-primary": brand.colors.primary,
    "--mate-bg": brand.colors.bg,
    "--mate-accent": brand.colors.accent,
  }
}

export const FREE_GREEN = '#3aa76d';
export const LOST_BROWN = '#5a4038';
export const BG_CARD = '#171717';
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
