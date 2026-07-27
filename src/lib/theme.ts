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
