import { describe, it, expect } from "vitest"
import { brandToCssVars } from "./theme"

describe("brandToCssVars", () => {
  it("maps brand colors to --mate CSS variables", () => {
    const vars = brandToCssVars({ logo_url: null, icon_url: null, palette_logo_url: null, palette_logo_is_icon_class: false, colors: { primary: "#e14d1a", bg: "#141414", accent: "#ede6e6", source: "default" } })
    expect(vars["--mate-primary"]).toBe("#e14d1a")
    expect(vars["--mate-bg"]).toBe("#141414")
  })

  // A session whose onboarding stopped before the color-pick step stores
  // brand as {}, which used to throw and 500 the entire dash layout.
  it("falls back to neutral colors when brand.colors is missing", () => {
    const vars = brandToCssVars({} as never)
    expect(vars["--mate-primary"]).toBe("#1f2937")
    expect(vars["--mate-bg"]).toBe("#ffffff")
    expect(vars["--mate-accent"]).toBe("#2563eb")
  })

  it("falls back when brand itself is null or undefined", () => {
    for (const brand of [null, undefined]) {
      const vars = brandToCssVars(brand)
      expect(vars["--mate-primary"]).toBe("#1f2937")
      expect(vars["--mate-bg"]).toBe("#ffffff")
    }
  })
})
