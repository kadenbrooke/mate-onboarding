import { describe, it, expect } from "vitest"
import { extractColorsFromCss, isSaturated } from "./css-colors"

describe("isSaturated", () => {
  it("treats a vivid orange as saturated", () => {
    expect(isSaturated(225, 77, 26)).toBe(true) // #e14d1a
  })

  it("rejects near-white, near-black, and grey neutrals", () => {
    expect(isSaturated(255, 255, 255)).toBe(false) // white
    expect(isSaturated(250, 250, 250)).toBe(false) // near-white
    expect(isSaturated(0, 0, 0)).toBe(false) // black
    expect(isSaturated(20, 20, 20)).toBe(false) // near-black
    expect(isSaturated(128, 128, 128)).toBe(false) // mid grey
    expect(isSaturated(31, 41, 55)).toBe(false) // slate-800 low-sat blue-grey
  })

  it("accepts a clearly saturated blue", () => {
    expect(isSaturated(37, 99, 235)).toBe(true) // #2563eb
  })
})

describe("extractColorsFromCss", () => {
  it("returns an orange-ish primary from repeated #e14d1a with a light bg", () => {
    const css = `
      .btn { background: #e14d1a; }
      .link { color: #e14d1a; }
      .hero { border-color: #e14d1a; }
      body { background: #ffffff; color: #141414; }
    `
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    // Red channel dominant on the primary -> orange.
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.primary)
    expect(m).toBeTruthy()
    const r = parseInt(m![1], 16)
    const g = parseInt(m![2], 16)
    const b = parseInt(m![3], 16)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it("parses 3-digit hex shorthand", () => {
    const css = `.a{color:#f50}.b{color:#f50}.c{color:#f50}` // #ff5500 orange
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.primary)
    const r = parseInt(m![1], 16)
    const b = parseInt(m![3], 16)
    expect(r).toBeGreaterThan(b)
  })

  it("parses rgb()/rgba() colors", () => {
    const css = `
      .a { color: rgb(225, 77, 26); }
      .b { color: rgba(225, 77, 26, 0.9); }
      .c { color: rgb(225, 77, 26); }
    `
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.primary)
    const r = parseInt(m![1], 16)
    const b = parseInt(m![3], 16)
    expect(r).toBeGreaterThan(b)
  })

  it("returns null when only greys / white / black are present", () => {
    const css = `
      body { background: #ffffff; color: #000000; }
      .card { background: #f5f5f5; border: 1px solid #e5e5e5; }
      .muted { color: #888888; }
      .dark { color: rgb(31, 41, 55); }
    `
    expect(extractColorsFromCss(css)).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(extractColorsFromCss("")).toBeNull()
  })

  it("picks a distinct accent when a second saturated color exists", () => {
    const css = `
      .primary { color: #e14d1a; }
      .primary2 { color: #e14d1a; }
      .primary3 { color: #e14d1a; }
      .secondary { color: #1a73e8; }
      .secondary2 { color: #1a73e8; }
      body { background: #ffffff; }
    `
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    // primary is the most frequent (orange), accent is the blue.
    expect(result!.primary).not.toBe(result!.accent)
  })

  it("chooses a dark bg when the dominant background color is dark", () => {
    const css = `
      body { background: #0d0d0d; }
      .wrap { background-color: #111111; }
      .brand { color: #e14d1a; }
      .brand2 { color: #e14d1a; }
    `
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.bg)
    const r = parseInt(m![1], 16)
    expect(r).toBeLessThan(90)
  })
})
