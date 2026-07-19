import { describe, it, expect } from "vitest"
import { extractColorsFromCss, isSaturated, extractColorCandidates } from "./css-colors"

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

  it("derives accent as a distinct, on-brand shade of primary (not a scavenged second color)", () => {
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
    // primary is the most frequent (orange).
    expect(result!.primary).toBe("#e14d1a")
    // accent is a lighter shade of the SAME hue, NOT the scavenged blue #1a73e8.
    expect(result!.accent).not.toBe(result!.primary)
    expect(result!.accent).not.toBe("#1a73e8")
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.accent)
    const ar = parseInt(m![1], 16)
    const ag = parseInt(m![2], 16)
    const ab = parseInt(m![3], 16)
    // Warm/orange family: red channel dominant on the accent too.
    expect(ar).toBeGreaterThan(ag)
    expect(ar).toBeGreaterThan(ab)
  })

  it("does NOT scavenge an incidental green as accent (auto-mate.business real tally)", () => {
    // Real frequency shape from auto-mate.business: orange dominates (primary),
    // green #22c55e appears only a handful of times (a single utility class).
    // Accent must be an orange-family shade, never the phantom green.
    const parts: string[] = []
    for (let i = 0; i < 40; i++) parts.push(`.o${i} { color: #e14d1a; }`)
    for (let i = 0; i < 7; i++) parts.push(`.g${i} { border-color: #22c55e; }`)
    parts.push(`body { background: #141414; }`)
    const css = parts.join("\n")

    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    expect(result!.primary).toBe("#e14d1a")
    // The phantom green must never become the accent.
    expect(result!.accent).not.toBe("#22c55e")
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.accent)
    const ar = parseInt(m![1], 16)
    const ag = parseInt(m![2], 16)
    const ab = parseInt(m![3], 16)
    // Warm/orange: red dominant, and NOT green (g not dominant).
    expect(ar).toBeGreaterThan(ag)
    expect(ar).toBeGreaterThan(ab)
  })

  it("returns null when the only saturated color is rare/incidental (frequency floor)", () => {
    // A page whose sole saturated color appears just twice amid neutrals should
    // NOT be crowned a brand; fall through so the caller keeps walking sources.
    const css = `
      body { background: #ffffff; color: #141414; }
      .card { background: #f5f5f5; border: 1px solid #e5e5e5; }
      .badge { color: #22c55e; }
      .badge2 { border-color: #22c55e; }
    `
    expect(extractColorsFromCss(css)).toBeNull()
  })

  it("chooses a dark bg when the dominant background color is dark", () => {
    const css = `
      body { background: #0d0d0d; }
      .wrap { background-color: #111111; }
      .brand { color: #e14d1a; }
      .brand2 { color: #e14d1a; }
      .brand3 { border-color: #e14d1a; }
    `
    const result = extractColorsFromCss(css)
    expect(result).not.toBeNull()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(result!.bg)
    const r = parseInt(m![1], 16)
    expect(r).toBeLessThan(90)
  })
})

describe("extractColorCandidates", () => {
  const css = `
    .a { color: #e14d1a } .b { background: #e14d1a } .c { border-color: #e14d1a }
    .d { color: #2a6f4d } .e { background-color: #2a6f4d }
    .f { color: #c0392b }
    body { background: #101418 } .g { background-color: #101418 }
    .h { background: #f5f2ec }
    .i { color: #ffffff } .j { color: #000000 }
  `
  it("ranks saturated primaries by frequency", () => {
    const c = extractColorCandidates(css)
    expect(c.primaries[0]).toBe("#e14d1a")
    expect(c.primaries).toContain("#2a6f4d")
    expect(c.primaries).toContain("#c0392b")
  })
  it("caps primaries at 5", () => {
    const many = Array.from({ length: 9 }, (_, i) => `.x${i} { color: #${i}${i}44${i}${i} }`).join("\n")
    expect(extractColorCandidates(many).primaries.length).toBeLessThanOrEqual(5)
  })
  it("collects background candidates from background declarations, deduped", () => {
    const c = extractColorCandidates(css)
    expect(c.backgrounds).toContain("#101418")
    expect(c.backgrounds).toContain("#f5f2ec")
    expect(new Set(c.backgrounds).size).toBe(c.backgrounds.length)
  })
  it("caps backgrounds at 3 and always includes the dark + light defaults when short", () => {
    const c = extractColorCandidates(".a { color: #e14d1a }")
    expect(c.backgrounds.length).toBeGreaterThanOrEqual(2)
    expect(c.backgrounds).toContain("#141414")
    expect(c.backgrounds).toContain("#ffffff")
  })
  it("returns empty primaries for a colorless page (never throws)", () => {
    expect(extractColorCandidates("").primaries).toEqual([])
  })
  it("keeps the light default even when three dark page bgs fill the slots", () => {
    const css = `
      .a { background: #101418 } .b { background-color: #16161a } .c { background: #202020 }
      .d { color: #e14d1a } .e { color: #e14d1a } .f { color: #e14d1a }
    `
    const c = extractColorCandidates(css)
    expect(c.backgrounds).toContain("#ffffff")
    expect(c.backgrounds.some((b) => b === "#141414" || b === "#101418")).toBe(true)
  })
})
