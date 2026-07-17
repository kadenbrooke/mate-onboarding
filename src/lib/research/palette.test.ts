import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { derivePalette, rgbToHex } from "./palette"

// Build a solid-color PNG in-memory so tests need no network and no fixtures.
function solidPng(
  hex: { r: number; g: number; b: number },
  size = 32
): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: hex.r, g: hex.g, b: hex.b },
    },
  })
    .png()
    .toBuffer()
}

// A logo-like image: a transparent canvas with a solid mark in the middle.
// Used to prove near-transparent pixels are skipped and the mark wins.
async function markOnTransparentPng(
  mark: { r: number; g: number; b: number },
  size = 48
): Promise<Buffer> {
  const half = Math.round(size / 2)
  const patch = await sharp({
    create: {
      width: half,
      height: half,
      channels: 4,
      background: { r: mark.r, g: mark.g, b: mark.b, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: patch, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

// Parse "#rrggbb" -> {r,g,b}
function fromHex(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`not a hex color: ${hex}`)
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  }
}

describe("rgbToHex", () => {
  it("formats channels as lowercase #rrggbb with zero-padding", () => {
    expect(rgbToHex(225, 77, 26)).toBe("#e14d1a")
    expect(rgbToHex(0, 0, 0)).toBe("#000000")
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff")
    expect(rgbToHex(1, 2, 3)).toBe("#010203")
  })

  it("clamps out-of-range channel values", () => {
    expect(rgbToHex(-5, 300, 128)).toBe("#00ff80")
  })
})

describe("derivePalette", () => {
  it("returns an orange-ish primary for a solid orange image (R > G,B)", async () => {
    const buf = await solidPng({ r: 225, g: 77, b: 26 })
    const { primary } = await derivePalette(buf)
    const c = fromHex(primary)
    // Orange => red channel clearly dominant, blue lowest.
    expect(c.r).toBeGreaterThan(c.g)
    expect(c.r).toBeGreaterThan(c.b)
    expect(c.g).toBeGreaterThanOrEqual(c.b)
    // Within a couple of quantization steps of the source orange.
    expect(Math.abs(c.r - 225)).toBeLessThanOrEqual(24)
  })

  it("skips transparent pixels: an orange mark on a transparent canvas is still orange", async () => {
    const buf = await markOnTransparentPng({ r: 225, g: 77, b: 26 })
    const { primary } = await derivePalette(buf)
    const c = fromHex(primary)
    expect(c.r).toBeGreaterThan(c.g)
    expect(c.r).toBeGreaterThan(c.b)
  })

  it("returns valid #rrggbb hex strings for primary, bg, and accent", async () => {
    const buf = await solidPng({ r: 20, g: 120, b: 200 })
    const p = await derivePalette(buf)
    for (const v of [p.primary, p.bg, p.accent]) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it("gives a dark bg for a dark-dominant logo and a light bg for a light one", async () => {
    const darkBuf = await solidPng({ r: 18, g: 18, b: 18 })
    const lightBuf = await solidPng({ r: 245, g: 245, b: 245 })
    const dark = await derivePalette(darkBuf)
    const light = await derivePalette(lightBuf)
    // Dark logo -> dark background; light logo -> light background.
    expect(fromHex(dark.bg).r).toBeLessThan(90)
    expect(fromHex(light.bg).r).toBeGreaterThan(180)
  })

  it("does not throw on an unreadable buffer; returns a safe default palette", async () => {
    const p = await derivePalette(Buffer.from("not an image at all"))
    for (const v of [p.primary, p.bg, p.accent]) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
