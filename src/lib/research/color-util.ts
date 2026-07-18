/**
 * Shared pure color helpers for brand-color derivation.
 *
 * NO model, NO sharp, NO network. Used by BOTH the CSS-extraction path
 * (css-colors.ts) and the logo-palette path (palette.ts) so the derived accent
 * is ALWAYS on-brand: a lighter shade of the primary in the SAME hue family,
 * never a scavenged second color that can drift to a phantom hue (the
 * auto-mate.business bug: an incidental #22c55e green getting crowned accent).
 */

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number // 0..360
  s: number // 0..1
  l: number // 0..1
}

/** Clamp a number into the 0..255 byte range, rounding. */
function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 255) return 255
  return Math.round(n)
}

/** Expand #rgb -> #rrggbb, normalize to an Rgb triple, or null if unparseable. */
export function parseHexColor(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** Format an Rgb triple as lowercase "#rrggbb", clamping each channel. */
export function rgbToHexColor(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

/** RGB (0..255) -> HSL (h 0..360, s/l 0..1). */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  let s = 0
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
  }

  let h = 0
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6
    } else if (max === gn) {
      h = (bn - rn) / delta + 2
    } else {
      h = (rn - gn) / delta + 4
    }
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s, l }
}

/** HSL (h 0..360, s/l 0..1) -> RGB (0..255). */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hp >= 0 && hp < 1) {
    r1 = c
    g1 = x
  } else if (hp < 2) {
    r1 = x
    g1 = c
  } else if (hp < 3) {
    g1 = c
    b1 = x
  } else if (hp < 4) {
    g1 = x
    b1 = c
  } else if (hp < 5) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }
  const m = l - c / 2
  return {
    r: clampByte((r1 + m) * 255),
    g: clampByte((g1 + m) * 255),
    b: clampByte((b1 + m) * 255),
  }
}

/** Clamp a 0..1 value into [0, 1]. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Derive an on-brand ACCENT as a LIGHTER shade of the primary. Same hue family,
 * raised lightness (a highlight), so the accent is always on-brand rather than a
 * scavenged second color that can drift to a phantom hue.
 *
 * Implementation: convert to HSL, raise lightness by ~0.15 (clamped so we never
 * blow past white), keep hue and saturation. For #e14d1a (orange) this yields a
 * lighter orange in the #f15d2a / brighter-orange family, with the red channel
 * still clearly dominant.
 *
 * Non-throwing: an unparseable input returns the input unchanged so callers can
 * safely pass whatever they resolved for primary.
 */
export function deriveAccent(primaryHex: string): string {
  const rgb = parseHexColor(primaryHex)
  if (!rgb) return primaryHex

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)

  // Raise lightness by ~0.15 toward white, clamped. For very dark primaries we
  // still get a visibly lighter shade; for already-light primaries the clamp
  // keeps us from producing an invalid/oversaturated value.
  const targetL = clamp01(l + 0.15)

  const out = hslToRgb(h, s, targetL)
  return rgbToHexColor(out.r, out.g, out.b)
}
