import { describe, it, expect } from "vitest"
import {
  deriveAccent,
  parseHexColor,
  rgbToHsl,
  hslToRgb,
  rgbToHexColor,
} from "./color-util"

// Perceived luminance (0..255) for asserting "lighter".
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function fromHex(hex: string): { r: number; g: number; b: number } {
  const c = parseHexColor(hex)
  if (!c) throw new Error(`not a hex color: ${hex}`)
  return c
}

describe("parseHexColor", () => {
  it("parses #rrggbb and #rgb shorthand", () => {
    expect(parseHexColor("#e14d1a")).toEqual({ r: 225, g: 77, b: 26 })
    expect(parseHexColor("#f50")).toEqual({ r: 255, g: 85, b: 0 })
  })

  it("returns null for garbage", () => {
    expect(parseHexColor("nope")).toBeNull()
    expect(parseHexColor("#12")).toBeNull()
  })
})

describe("rgbToHsl / hslToRgb round-trip", () => {
  it("round-trips a vivid orange within a small tolerance", () => {
    const { h, s, l } = rgbToHsl(225, 77, 26)
    const back = hslToRgb(h, s, l)
    expect(Math.abs(back.r - 225)).toBeLessThanOrEqual(2)
    expect(Math.abs(back.g - 77)).toBeLessThanOrEqual(2)
    expect(Math.abs(back.b - 26)).toBeLessThanOrEqual(2)
  })

  it("formats hex lowercase with padding", () => {
    expect(rgbToHexColor(1, 2, 3)).toBe("#010203")
    expect(rgbToHexColor(225, 77, 26)).toBe("#e14d1a")
  })
})

describe("deriveAccent", () => {
  it("returns a LIGHTER shade of the primary (higher luminance)", () => {
    const accent = deriveAccent("#e14d1a")
    const p = fromHex("#e14d1a")
    const a = fromHex(accent)
    expect(luminance(a.r, a.g, a.b)).toBeGreaterThan(
      luminance(p.r, p.g, p.b)
    )
  })

  it("keeps the warm/orange hue family: red channel dominant, and warmer than green/blue", () => {
    const a = fromHex(deriveAccent("#e14d1a"))
    // Orange => red clearly dominant over both green and blue.
    expect(a.r).toBeGreaterThan(a.g)
    expect(a.r).toBeGreaterThan(a.b)
    // Same hue family as primary: hue should stay close to the input's hue.
    const pHsl = rgbToHsl(225, 77, 26)
    const aHsl = rgbToHsl(a.r, a.g, a.b)
    expect(Math.abs(aHsl.h - pHsl.h)).toBeLessThan(6)
  })

  it("never yields a green (accent is NOT #22c55e-like) for an orange primary", () => {
    const a = fromHex(deriveAccent("#e14d1a"))
    // Green would have g dominant; assert it does not.
    expect(a.g).toBeLessThan(a.r)
  })

  it("is non-throwing and returns the input unchanged for an unparseable value", () => {
    expect(deriveAccent("not-a-color")).toBe("not-a-color")
  })

  it("produces a valid #rrggbb hex", () => {
    expect(deriveAccent("#e14d1a")).toMatch(/^#[0-9a-f]{6}$/)
  })
})
