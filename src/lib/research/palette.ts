import sharp from "sharp"
import { deriveAccent } from "./color-util"

/**
 * Palette derivation from a logo image.
 *
 * Pure image math (sharp), NO model. Given a logo buffer we downscale it,
 * walk the raw pixels, build a quantized color histogram, and pick the most
 * frequent SATURATED color as the brand primary. Near-transparent pixels and
 * near-neutral (white/black/grey) pixels are excluded when choosing the brand
 * color so a logo on a white or black canvas still yields the real primary. The
 * accent is DERIVED from primary as a lighter same-hue shade (deriveAccent), not
 * scavenged from a second logo color.
 *
 * Never throws: on any sharp/decoding error it returns SAFE_DEFAULT so research
 * can fall through the source chain in the caller.
 */

export interface Palette {
  primary: string
  bg: string
  accent: string
}

// Neutral fallback (near-black / white / blue): same shape the route used
// before, kept as the absolute last resort if the image is undecodable.
const SAFE_DEFAULT: Palette = {
  primary: "#1f2937",
  bg: "#ffffff",
  accent: "#2563eb",
}

const DARK_BG = "#141414"
const LIGHT_BG = "#ffffff"

/** Clamp a number into the 0..255 byte range. */
function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 255) return 255
  return Math.round(n)
}

/** Format r,g,b as lowercase "#rrggbb", clamping each channel to 0..255. */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Quantization step: round each channel to the nearest 16 to collapse the
// histogram into a manageable number of buckets.
const STEP = 16

function quantize(v: number): number {
  return Math.min(240, Math.round(v / STEP) * STEP)
}

function bucketKey(r: number, g: number, b: number): number {
  // 0..255 quantized to <=16 levels each; pack into a single int key.
  return (quantize(r) << 16) | (quantize(g) << 8) | quantize(b)
}

function unpack(key: number): { r: number; g: number; b: number } {
  return { r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff }
}

/** HSV-style saturation on a 0..1 scale for an rgb triple. */
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

// A color counts as a candidate "brand" color when it is saturated enough and
// not a near-white / near-black neutral.
const MIN_SATURATION = 0.18
const NEAR_WHITE = 232
const NEAR_BLACK = 24

function isBrandCandidate(r: number, g: number, b: number): boolean {
  const lum = luminance(r, g, b)
  if (lum >= NEAR_WHITE) return false // near-white
  if (lum <= NEAR_BLACK) return false // near-black
  return saturation(r, g, b) >= MIN_SATURATION
}

export async function derivePalette(imageBuffer: Buffer): Promise<Palette> {
  try {
    // Downscale to keep the pixel walk cheap; ensure an alpha channel exists so
    // we can skip transparent pixels uniformly (PNG logos often have one).
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 64, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const channels = info.channels // 4 after ensureAlpha
    if (!data || data.length < channels) return SAFE_DEFAULT

    // Two histograms:
    //  - brandHist: only saturated, non-neutral pixels (candidate brand colors)
    //  - allHist:   every visible (non-transparent) pixel (used for bg light/dark)
    const brandHist = new Map<number, number>()
    const allHist = new Map<number, number>()

    let visibleCount = 0
    let darkWeight = 0
    let lightWeight = 0

    for (let i = 0; i + channels <= data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = channels >= 4 ? data[i + 3] : 255

      // Skip near-transparent pixels entirely.
      if (a < 16) continue
      visibleCount++

      const allKey = bucketKey(r, g, b)
      allHist.set(allKey, (allHist.get(allKey) ?? 0) + 1)

      // Track light-vs-dark of visible pixels to decide the background.
      if (luminance(r, g, b) < 128) darkWeight++
      else lightWeight++

      if (isBrandCandidate(r, g, b)) {
        const key = bucketKey(r, g, b)
        brandHist.set(key, (brandHist.get(key) ?? 0) + 1)
      }
    }

    if (visibleCount === 0) return SAFE_DEFAULT

    // Background: if the logo's visible pixels skew dark, use a dark bg; else light.
    const bg = darkWeight > lightWeight ? DARK_BG : LIGHT_BG

    // Rank brand-candidate buckets by frequency.
    const ranked = [...brandHist.entries()].sort((x, y) => y[1] - x[1])

    let primaryHex: string
    let accentHex: string

    if (ranked.length === 0) {
      // No saturated brand color found (e.g. a pure greyscale logo). Fall back
      // to the most common visible color for primary and a bg-appropriate accent.
      const topAll = [...allHist.entries()].sort((x, y) => y[1] - x[1])[0]
      const c = unpack(topAll[0])
      primaryHex = rgbToHex(c.r, c.g, c.b)
      accentHex = bg === DARK_BG ? "#ede6e6" : "#141414"
      return { primary: primaryHex, bg, accent: accentHex }
    }

    const primaryKey = ranked[0][0]
    const p = unpack(primaryKey)
    primaryHex = rgbToHex(p.r, p.g, p.b)

    // Accent = an on-brand LIGHTER shade of primary (same hue family), NOT a
    // scavenged second logo color. Deriving from primary keeps accent on-brand
    // by construction, matching the CSS-extraction path.
    accentHex = deriveAccent(primaryHex)

    return { primary: primaryHex, bg, accent: accentHex }
  } catch {
    // Undecodable / not an image / sharp failure: safe default, never throw.
    return SAFE_DEFAULT
  }
}
