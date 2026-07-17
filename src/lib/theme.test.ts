import { describe, it, expect } from "vitest"
import { brandToCssVars } from "./theme"

describe("brandToCssVars", () => {
  it("maps brand colors to --mate CSS variables", () => {
    const vars = brandToCssVars({ logo_url: null, colors: { primary: "#e14d1a", bg: "#141414", accent: "#ede6e6", source: "default" } })
    expect(vars["--mate-primary"]).toBe("#e14d1a")
    expect(vars["--mate-bg"]).toBe("#141414")
  })
})
