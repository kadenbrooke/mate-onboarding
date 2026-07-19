import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { derivePalette } from "./palette"
import { extractColorsFromCss, extractColorCandidates } from "./css-colors"

const DEFAULT_COLORS = {
  primary: "#1f2937",
  bg: "#ffffff",
  accent: "#2563eb",
} as const

export function normalizeUrl(input: string): string {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = "https://" + u
  return u.replace(/\/+$/, "")
}

function resolve(base: string, href: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** Where a brand's colors ultimately came from, so the caller can tell. */
export type BrandColorSource =
  | "logo"
  | "css"
  | "theme-color"
  | "manifest"
  | "default"

export interface Brand {
  /**
   * Best logo URL for DISPLAY. May be a .ico or .svg (all we have), so it is NOT
   * necessarily safe to hand to sharp — use palette_logo_url for that.
   */
  logo_url: string | null
  /**
   * The raw <link rel="icon"> href, exposed separately so display code can fall
   * back to it even when a nicer raster (og:image / apple-touch-icon) is used as
   * the display logo. Usually the favicon (often a .ico).
   */
  icon_url: string | null
  /**
   * A logo URL that is safe to decode with sharp for palette derivation: a real
   * raster (.png/.jpg/.jpeg/.webp/.gif). Null when the only logo we found is an
   * .ico or .svg (sharp can't reliably decode those), so the caller knows to skip
   * the logo palette step and fall through to CSS/theme-color.
   */
  palette_logo_url: string | null
  /**
   * True when palette_logo_url came from an ICON-class source (apple-touch-icon
   * or <link rel=icon>) rather than a substantial og:image. Icon-class rasters
   * (favicons, home-screen tiles) are tiny and often dark/muddy, so they are a
   * WEAKER palette signal than a page's CSS. The resolver uses this to order CSS
   * ahead of an icon-class logo, while a real og:image still wins outright.
   */
  palette_logo_is_icon_class: boolean
  colors: {
    primary: string
    bg: string
    accent: string
    source: BrandColorSource
  }
  /** Ranked picker candidates for the ColorCard (Phase 2). Optional: older
   *  persisted sessions won't have it; the card falls back to colors.primary. */
  candidates?: {
    primaries: string[]
    backgrounds: string[]
  }
}

// Raster extensions sharp can decode reliably. .ico and .svg are deliberately
// excluded (sharp cannot decode .ico at all, and .svg needs rasterization we
// don't want to depend on for palette accuracy).
const RASTER_EXT_RE = /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i

/** True when the URL clearly points at a raster image sharp can use. */
function isRasterUrl(url: string): boolean {
  return RASTER_EXT_RE.test(url)
}

export function extractBrandFromHtml(html: string, baseUrl: string): Brand {
  const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").trim()

  // Candidate logo sources, in preference order for producing a REAL raster we
  // can feed to sharp: og:image -> apple-touch-icon -> <link rel="icon">.
  const ogImage = pick(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  )
  const appleIcon = pick(
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i
  )
  const linkIcon = pick(
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i
  )

  const ogAbs = ogImage ? resolve(baseUrl, ogImage) : null
  const appleAbs = appleIcon ? resolve(baseUrl, appleIcon) : null
  const iconAbs = linkIcon ? resolve(baseUrl, linkIcon) : null

  // og:image is a SUBSTANTIAL brand/share image; apple-touch-icon and
  // <link rel=icon> are ICON-class (tiny, often dark/muddy). We still allow an
  // icon-class raster as a palette candidate, but flag it so the resolver can
  // rank CSS ahead of it.
  const ogIsRaster = ogAbs !== null && isRasterUrl(ogAbs)
  const iconRaster =
    [appleAbs, iconAbs].find((u) => u !== null && isRasterUrl(u)) ?? null

  // palette_logo_url: prefer a substantial og:image raster, else an icon raster.
  // Never a .ico/.svg.
  const palette_logo_url = ogIsRaster ? ogAbs : iconRaster
  const palette_logo_is_icon_class = !ogIsRaster && iconRaster !== null

  // logo_url (for display): prefer a real raster, else fall back to whatever icon
  // we have (even a .ico/.svg) so the UI still shows a logo.
  const logo_url = palette_logo_url ?? ogAbs ?? appleAbs ?? iconAbs

  const themeColor = pick(
    /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,8})["']/i
  )

  const colors = themeColor
    ? { ...DEFAULT_COLORS, primary: themeColor, source: "theme-color" as const }
    : { ...DEFAULT_COLORS, source: "default" as const }

  return {
    logo_url,
    icon_url: iconAbs,
    palette_logo_url,
    palette_logo_is_icon_class,
    colors,
  }
}

export async function fetchSite(
  url: string
): Promise<{ html: string | null; finalUrl: string }> {
  const finalUrl = normalizeUrl(url)
  try {
    const res = await fetch(finalUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { html: null, finalUrl }
    return { html: await res.text(), finalUrl }
  } catch {
    return { html: null, finalUrl }
  }
}

/**
 * Fetch an image URL into a Buffer. Never throws; returns null on any failure,
 * timeout, non-image, or absurd payload so callers can fall through the source
 * chain. Handles data: URLs inline (no network round-trip).
 */
export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      // data:[<mediatype>][;base64],<data>
      const comma = url.indexOf(",")
      if (comma === -1) return null
      const meta = url.slice(5, comma)
      const payload = url.slice(comma + 1)
      if (/;base64/i.test(meta)) {
        return Buffer.from(payload, "base64")
      }
      return Buffer.from(decodeURIComponent(payload), "utf8")
    }

    if (!/^https?:\/\//i.test(url)) return null

    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null

    const type = res.headers.get("content-type") ?? ""
    // Best-effort guard: skip obvious non-images (SVG is fine, sharp reads it).
    if (type && !/^image\//i.test(type) && !type.includes("octet-stream")) {
      return null
    }

    const ab = await res.arrayBuffer()
    // Guard against absurd payloads (10MB cap).
    if (ab.byteLength === 0 || ab.byteLength > 10_000_000) return null
    return Buffer.from(ab)
  } catch {
    return null
  }
}

/**
 * Best-effort read of a linked web app manifest's theme_color.
 * Returns a "#rrggbb"-ish string or null. Never throws.
 */
async function fetchManifestThemeColor(
  html: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const href = (
      html.match(
        /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i
      )?.[1] ?? ""
    ).trim()
    if (!href) return null

    const manifestUrl = resolve(baseUrl, href)
    if (!/^https?:\/\//i.test(manifestUrl)) return null

    const res = await fetch(manifestUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { theme_color?: unknown }
    const color =
      typeof json.theme_color === "string" ? json.theme_color.trim() : ""
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null
  } catch {
    return null
  }
}

/**
 * Best-effort fetch of a linked stylesheet's text. Same-origin only, short
 * timeout, capped size. Returns "" on any failure. Never throws.
 */
async function fetchStylesheet(url: string): Promise<string> {
  try {
    if (!/^https?:\/\//i.test(url)) return ""
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return ""
    const type = res.headers.get("content-type") ?? ""
    // Best-effort guard: only trust things that look like CSS.
    if (type && !/css|text\/plain|octet-stream/i.test(type)) return ""
    const text = await res.text()
    // Cap so a giant bundle can't blow the budget.
    return text.slice(0, 400_000)
  } catch {
    return ""
  }
}

/**
 * Extract brand colors from a page's MARKUP: inline style="" attributes, inline
 * <style> blocks, and (best-effort) up to two same-origin linked stylesheets.
 * Tallies saturated colors and returns primary/accent/bg, or null if nothing
 * saturated was found. Never throws (research must never 500).
 *
 * This recovers the real brand color for sites whose logo is an undecodable .ico
 * favicon and which set no theme-color meta (e.g. auto-mate.business, orange in
 * CSS only).
 */
export async function extractBrandColorsFromMarkup(
  html: string,
  baseUrl: string
): Promise<{ primary: string; bg: string; accent: string; candidates?: { primaries: string[]; backgrounds: string[] } } | null> {
  if (!html) return null

  // Inline <style> blocks.
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n")

  // Inline style="" attributes.
  const inlineStyles = [...html.matchAll(/\bstyle=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .join(";")

  // Same-origin linked stylesheets (cap at 2 to bound the network work).
  let origin = ""
  try {
    origin = new URL(baseUrl).origin
  } catch {
    origin = ""
  }

  const cssLinks = [
    ...html.matchAll(
      /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi
    ),
  ]
    .map((m) => (m[0].match(/href=["']([^"']+)["']/i)?.[1] ?? "").trim())
    .filter(Boolean)
    .map((href) => resolve(baseUrl, href))
    .filter((u) => (origin ? u.startsWith(origin) : /^https?:\/\//i.test(u)))
    .slice(0, 2)

  const linkedCss = (
    await Promise.all(cssLinks.map((u) => fetchStylesheet(u)))
  ).join("\n")

  const combined = [styleBlocks, inlineStyles, linkedCss]
    .filter(Boolean)
    .join("\n")

  const palette = extractColorsFromCss(combined)
  if (!palette) return null
  return { ...palette, candidates: extractColorCandidates(combined) }
}

/**
 * Derive a palette from base.palette_logo_url via sharp, or null if it can't be
 * fetched or produced only a neutral SAFE_DEFAULT (which would otherwise be
 * mislabeled as a real logo palette). Never throws.
 */
async function logoPalette(
  base: Brand
): Promise<{ primary: string; bg: string; accent: string } | null> {
  if (!base.palette_logo_url) return null
  const buf = await fetchImageBuffer(base.palette_logo_url)
  if (!buf) return null
  const palette = await derivePalette(buf)
  // derivePalette returns SAFE_DEFAULT (neutral blue) when it finds no brand
  // color. Only trust the logo when it produced a NON-default palette.
  const isDefaultish =
    palette.primary === DEFAULT_COLORS.primary &&
    palette.accent === DEFAULT_COLORS.accent
  return isDefaultish ? null : palette
}

/**
 * Resolve a brand's colors through a preference chain, first REAL palette wins.
 * `colors.source` is set HONESTLY to whatever actually produced them:
 *   1. SUBSTANTIAL logo (og:image) -> derivePalette. A genuine brand image is
 *      the strongest signal. (.ico/.svg are skipped upstream, so a favicon can
 *      never masquerade as a logo palette.)
 *   2. css/markup color extraction (inline styles, <style>, linked stylesheets).
 *      Ranked ABOVE icon-class logos: a page's CSS is a stronger brand-color
 *      signal than a tiny, often-dark favicon / home-screen tile.
 *   3. ICON-class logo (apple-touch-icon / favicon raster) -> derivePalette.
 *   4. <meta name="theme-color">   (already parsed into base.colors)
 *   5. web manifest theme_color    (best-effort fetch)
 *   6. hardcoded neutral defaults  (LAST)
 *
 * `base` is the Brand produced by extractBrandFromHtml. Never throws.
 */
export async function resolveBrandColors(
  base: Brand,
  html: string,
  baseUrl: string
): Promise<Brand> {
  // 1. Substantial logo (og:image) palette wins outright.
  if (!base.palette_logo_is_icon_class) {
    const palette = await logoPalette(base)
    if (palette) {
      return { ...base, colors: { ...palette, source: "logo" } }
    }
  }

  // 2. CSS / markup color extraction (above icon-class logos).
  const cssColors = await extractBrandColorsFromMarkup(html, baseUrl)
  if (cssColors) {
    const { candidates: cssCandidates, ...cssColorFields } = cssColors
    return {
      ...base,
      colors: { ...cssColorFields, source: "css" },
      candidates: cssCandidates,
    }
  }

  // 3. Icon-class logo palette (weaker signal, so it runs after CSS).
  if (base.palette_logo_is_icon_class) {
    const palette = await logoPalette(base)
    if (palette) {
      return { ...base, colors: { ...palette, source: "logo" } }
    }
  }

  // 4. theme-color meta (extractBrandFromHtml already applied it).
  if (base.colors.source === "theme-color") {
    return base
  }

  // 5. web manifest theme_color.
  const manifestColor = await fetchManifestThemeColor(html, baseUrl)
  if (manifestColor) {
    return {
      ...base,
      colors: { ...DEFAULT_COLORS, primary: manifestColor, source: "manifest" },
    }
  }

  // 6. neutral defaults (base already carries source: "default").
  return base
}

export interface CompanyData {
  name?: string
  services?: string[]
  hours?: string
  service_area?: string
  phone?: string
  about?: string
  email?: string
  address?: string
  social?: string[]
  published_channels?: string[]
}

export async function extractCompanyData(html: string | null): Promise<CompanyData> {
  if (!html) return {}
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 8000)

  // Lazy-init the model client inside the handler (never at module scope), so a
  // missing OPENAI key at build/import time can't break the app.
  try {
    const { text: json } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: [
        "Extract company info from the website text below as a single JSON object.",
        "Keys (all optional, omit if truly unknown):",
        "  name: string",
        "  services: string[] (the services/offerings the business provides)",
        "  hours: string (business hours, human-readable)",
        "  service_area: string (cities/regions served)",
        "  phone: string",
        "  email: string",
        "  address: string (full street address if present)",
        "  social: string[] (full URLs to social/business profiles: Facebook, Instagram, Yelp, Google Business, LinkedIn, X/Twitter, etc.)",
        '  published_channels: string[] (which platforms the site links to, e.g. "Google Business", "Facebook", "Instagram", "Yelp")',
        "Do not invent values. Return ONLY the JSON object, no prose, no code fences.",
        "",
        "Website text:",
        text,
      ].join("\n"),
    })
    return JSON.parse(json.replace(/```json|```/g, "").trim()) as CompanyData
  } catch {
    return {}
  }
}
