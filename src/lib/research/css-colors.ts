/**
 * CSS / markup color extraction.
 *
 * Pure string parsing, NO model, NO sharp. Given the raw text of a page's CSS
 * (inline style="", <style> blocks, and best-effort linked stylesheets — the
 * fetching lives in website.ts), we tally every hex and rgb()/rgba() color,
 * filter out near-neutrals (near-white, near-black, low-saturation greys), and
 * pick the most frequent SATURATED color as the brand primary (subject to a
 * frequency floor so a one-off incidental color can't be crowned the brand). The
 * accent is DERIVED from primary as a lighter same-hue shade (see color-util's
 * deriveAccent), NOT scavenged from a second saturated color which could drift to
 * a phantom hue. The dominant BACKGROUND color decides light vs dark bg.
 *
 * This exists because many brands (e.g. auto-mate.business) only expose their
 * brand color in CSS: the logo is a .ico favicon that sharp can't decode, and
 * there's no theme-color meta. Scanning CSS recovers the real accent.
 *
 * Never throws: returns null when nothing saturated is found so the caller can
 * fall through to the next source in the resolution chain.
 */

import { deriveAccent } from "./color-util"

export interface CssPalette {
  primary: string
  bg: string
  accent: string
}

const DARK_BG = "#141414"
const LIGHT_BG = "#ffffff"

// Saturation / neutral thresholds. Mirror the palette.ts logic so CSS-derived and
// logo-derived colors agree on what counts as a real brand color.
const MIN_SATURATION = 0.25
const NEAR_WHITE = 232
const NEAR_BLACK = 24
// Minimum absolute chroma (max channel - min channel, 0..255). A high saturation
// RATIO alone lets dark blue-greys (e.g. slate #1f2937, spread 24) sneak through
// as "brand" colors; requiring real channel spread rejects those muted UI greys
// while keeping vivid brand colors (orange #e14d1a has spread 199).
const MIN_CHROMA = 40

// Frequency floor for crowning a saturated color as the brand `primary`. A site
// whose only saturated color is incidental (e.g. a single `border-[#22c55e]/30`
// utility appearing a handful of times) should NOT be themed to that one-off
// color; we'd rather fall through to theme-color / manifest / default. The top
// saturated color must appear at least this many times, OR clearly lead the next
// saturated color by a wide margin (a dominant brand color always does).
const MIN_PRIMARY_ABSOLUTE = 3
const MIN_PRIMARY_FRACTION = 0.05
// A top color that laps the runner-up by this factor is clearly the brand even
// if the page is tiny, so it bypasses the absolute/fraction floor.
const DOMINANCE_MARGIN = 3

interface Rgb {
  r: number
  g: number
  b: number
}

/** HSV-style saturation on a 0..1 scale. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === 0) return 0
  return (max - min) / max
}

/** Perceived luminance (0..255). */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * A color is a brand candidate when it is saturated enough and is neither a
 * near-white nor a near-black neutral. Exported so tests and website.ts share the
 * exact same notion of "saturated".
 */
export function isSaturated(r: number, g: number, b: number): boolean {
  const lum = luminance(r, g, b)
  if (lum >= NEAR_WHITE) return false
  if (lum <= NEAR_BLACK) return false
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  if (chroma < MIN_CHROMA) return false
  return saturation(r, g, b) >= MIN_SATURATION
}

function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 255) return 255
  return Math.round(n)
}

function toHex(rgb: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, "0")
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`
}

/** Expand #rgb -> #rrggbb, normalize to a lowercase Rgb triple, or null. */
function parseHex(hex: string): Rgb | null {
  let h = hex.replace(/^#/, "")
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

// #rgb or #rrggbb (word-bounded so we don't grab #rrggbbaa mid-string as #rrggbb).
const HEX_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
// rgb(...) / rgba(...) with 0..255 channels.
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)/gi
// Background declarations, so we can weigh which color dominates the page bg.
const BG_DECL_RE = /background(?:-color)?\s*:\s*([^;}{]+)/gi

/** Pull every hex + rgb() color out of a CSS string, in document order. */
function collectColors(css: string): Rgb[] {
  const out: Rgb[] = []

  let m: RegExpExecArray | null
  HEX_RE.lastIndex = 0
  while ((m = HEX_RE.exec(css)) !== null) {
    const rgb = parseHex(m[1])
    if (rgb) out.push(rgb)
  }

  RGB_RE.lastIndex = 0
  while ((m = RGB_RE.exec(css)) !== null) {
    const r = Number(m[1])
    const g = Number(m[2])
    const b = Number(m[3])
    if (r <= 255 && g <= 255 && b <= 255) out.push({ r, g, b })
  }

  return out
}

/** Colors that appear in `background`/`background-color` declarations only. */
function collectBackgroundColors(css: string): Rgb[] {
  const out: Rgb[] = []
  let decl: RegExpExecArray | null
  BG_DECL_RE.lastIndex = 0
  while ((decl = BG_DECL_RE.exec(css)) !== null) {
    for (const c of collectColors(decl[1])) out.push(c)
  }
  return out
}

function keyOf(rgb: Rgb): string {
  return `${rgb.r},${rgb.g},${rgb.b}`
}

function fromKey(key: string): Rgb {
  const [r, g, b] = key.split(",").map(Number)
  return { r, g, b }
}

/**
 * Extract a brand palette from a blob of CSS/markup text. Returns null when no
 * saturated (non-neutral) color is present, so the caller keeps walking its
 * source chain.
 */
export function extractColorsFromCss(css: string): CssPalette | null {
  if (!css || css.trim() === "") return null

  const all = collectColors(css)
  if (all.length === 0) return null

  // Frequency-tally the SATURATED colors only.
  const satCounts = new Map<string, number>()
  let totalSatMentions = 0
  for (const c of all) {
    if (!isSaturated(c.r, c.g, c.b)) continue
    const k = keyOf(c)
    satCounts.set(k, (satCounts.get(k) ?? 0) + 1)
    totalSatMentions++
  }
  if (satCounts.size === 0) return null

  const ranked = [...satCounts.entries()].sort((x, y) => y[1] - x[1])

  // Frequency floor: only crown the top saturated color as `primary` when it is
  // actually the brand and not incidental noise. It qualifies if it clears an
  // absolute + fractional floor, OR clearly dominates the runner-up. If the top
  // saturated color is itself rare, return null so the caller falls through to
  // theme-color / manifest / default rather than theming to a one-off color.
  const topCount = ranked[0][1]
  const runnerUpCount = ranked[1]?.[1] ?? 0
  const floor = Math.max(
    MIN_PRIMARY_ABSOLUTE,
    Math.ceil(MIN_PRIMARY_FRACTION * totalSatMentions)
  )
  const dominates =
    runnerUpCount === 0
      ? topCount >= MIN_PRIMARY_ABSOLUTE
      : topCount >= runnerUpCount * DOMINANCE_MARGIN
  if (topCount < floor && !dominates) return null

  const primary = fromKey(ranked[0][0])

  // Accent = an on-brand LIGHTER shade of primary (same hue family), NOT a
  // scavenged second saturated color. Scavenging is what produced the phantom
  // green accent on auto-mate.business; deriving from primary keeps accent on
  // brand by construction.
  const accent = deriveAccent(toHex(primary))

  // Background: pick the most frequent color that appears in a background
  // declaration; fall back to the most frequent color overall. Then decide
  // light vs dark by its luminance.
  const bgColors = collectBackgroundColors(css)
  const bgSource = bgColors.length > 0 ? bgColors : all
  const bgCounts = new Map<string, number>()
  for (const c of bgSource) {
    const k = keyOf(c)
    bgCounts.set(k, (bgCounts.get(k) ?? 0) + 1)
  }
  const bgTop = [...bgCounts.entries()].sort((x, y) => y[1] - x[1])[0]
  const bgRgb = fromKey(bgTop[0])
  const bg = luminance(bgRgb.r, bgRgb.g, bgRgb.b) < 128 ? DARK_BG : LIGHT_BG

  return {
    primary: toHex(primary),
    bg,
    accent,
  }
}
