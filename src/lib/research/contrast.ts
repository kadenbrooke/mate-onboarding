/**
 * WCAG contrast math + nearest-AA shade adjustment.
 *
 * Pure, no I/O. Used by the in-chat ColorCard to (a) gate confirm on the
 * AA 4.5:1 text threshold and (b) power "Fix it for me": adjust the chosen
 * primary's LIGHTNESS ONLY (hue + saturation preserved, same family) until the
 * combo passes against the chosen background. This is the 3TR fix: a client can
 * never confirm an unreadable primary/bg pair.
 *
 * Never throws: unparseable input degrades (ratio 1 / value returned unchanged)
 * so callers can pass whatever the extraction produced.
 */
import { parseHexColor, rgbToHsl, hslToRgb, rgbToHexColor } from "./color-util"

export const AA_TEXT_RATIO = 4.5

/** WCAG relative luminance (0..1) of a hex color; null if unparseable. */
function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex)
  if (!rgb) return null
  const chan = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b)
}

/** WCAG contrast ratio (1..21). Unparseable input -> 1 (worst), never throws. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  if (la === null || lb === null) return 1
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** True when the pair clears the AA text threshold (4.5:1). */
export function meetsAA(fgHex: string, bgHex: string): boolean {
  return contrastRatio(fgHex, bgHex) >= AA_TEXT_RATIO
}

/**
 * Nearest AA-passing shade of `fgHex` against `bgHex`, adjusting lightness only.
 * Walks lightness away from the background's tone in small steps (lighten on a
 * dark bg, darken on a light bg) and returns the FIRST passing shade, i.e. the
 * closest to the client's original pick. Falls back to the far extreme if the
 * walk somehow never passes (the clamp guarantees termination either way).
 */
export function nearestAA(fgHex: string, bgHex: string): string {
  if (meetsAA(fgHex, bgHex)) return fgHex
  const rgb = parseHexColor(fgHex)
  const bgLum = relativeLuminance(bgHex)
  if (!rgb || bgLum === null) return fgHex

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const lighten = bgLum < 0.5 // dark bg -> walk toward white
  const step = 0.02

  for (
    let nl = l;
    lighten ? nl <= 1 : nl >= 0;
    nl = lighten ? nl + step : nl - step
  ) {
    const c = hslToRgb(h, s, Math.min(1, Math.max(0, nl)))
    const candidate = rgbToHexColor(c.r, c.g, c.b)
    if (meetsAA(candidate, bgHex)) return candidate
  }
  return lighten ? "#ffffff" : "#000000"
}
