import type { Brand } from "./research/website"

export function brandToCssVars(brand: Brand): Record<string, string> {
  return {
    "--mate-primary": brand.colors.primary,
    "--mate-bg": brand.colors.bg,
    "--mate-accent": brand.colors.accent,
  }
}
