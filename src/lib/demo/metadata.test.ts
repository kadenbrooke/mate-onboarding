import { describe, it, expect } from "vitest"
import {
  extractSiteMetadata,
  parseJsonLd,
  cleanTitle,
} from "./metadata"

describe("cleanTitle", () => {
  it("returns '' for empty/nullish input", () => {
    expect(cleanTitle("")).toBe("")
    expect(cleanTitle(undefined)).toBe("")
    expect(cleanTitle(null)).toBe("")
    expect(cleanTitle("   ")).toBe("")
  })

  it("strips a trailing '| Home' boilerplate segment", () => {
    expect(cleanTitle("Acme Plumbing | Home")).toBe("Acme Plumbing")
  })

  it("strips ' - Official Site' boilerplate", () => {
    expect(cleanTitle("Bob's HVAC - Official Site")).toBe("Bob's HVAC")
  })

  it("strips repeated boilerplate tails", () => {
    expect(cleanTitle("Acme | Welcome | Home")).toBe("Acme")
  })

  it("takes the leading segment when a separator/tagline remains", () => {
    expect(cleanTitle("Rivertown Roofing | Fast, Reliable Roofers")).toBe(
      "Rivertown Roofing"
    )
  })

  it("leaves a clean single name untouched", () => {
    expect(cleanTitle("Green Valley Landscaping")).toBe("Green Valley Landscaping")
  })

  it("collapses internal whitespace", () => {
    expect(cleanTitle("  Acme   Plumbing  ")).toBe("Acme Plumbing")
  })
})

describe("parseJsonLd", () => {
  it("pulls name from a LocalBusiness node", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Plumber","name":"Acme Plumbing","telephone":"801-555-0100"}
    </script>`
    const out = parseJsonLd(html)
    expect(out.name).toBe("Acme Plumbing")
    expect(out.name_source).toBe("json-ld")
    expect(out.phone).toBe("801-555-0100")
  })

  it("handles an @graph wrapper and prefers the business over a bare WebSite", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"acme.example"},
        {"@type":"LocalBusiness","name":"Acme Plumbing Co","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Orem"}}
      ]}
    </script>`
    const out = parseJsonLd(html)
    expect(out.name).toBe("Acme Plumbing Co")
    expect(out.address).toBe("1 Main St, Orem")
  })

  it("extracts services from makesOffer", () => {
    const html = `<script type="application/ld+json">
      {"@type":"HVACBusiness","name":"Cool Air","makesOffer":[
        {"@type":"Offer","itemOffered":{"@type":"Service","name":"AC Repair"}},
        {"@type":"Offer","name":"Furnace Install"}
      ]}
    </script>`
    const out = parseJsonLd(html)
    expect(out.name).toBe("Cool Air")
    expect(out.services).toEqual(["AC Repair", "Furnace Install"])
  })

  it("returns {} on malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{ not valid json </script>`
    expect(parseJsonLd(html)).toEqual({})
  })

  it("returns {} when no org/business node is present", () => {
    const html = `<script type="application/ld+json">
      {"@type":"BreadcrumbList","itemListElement":[]}
    </script>`
    expect(parseJsonLd(html)).toEqual({})
  })
})

describe("extractSiteMetadata precedence", () => {
  it("JSON-LD name wins over og:site_name and title", () => {
    const html = `
      <head>
        <title>Acme | Home</title>
        <meta property="og:site_name" content="Acme OG">
        <script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme Plumbing LLC"}</script>
      </head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Acme Plumbing LLC")
    expect(out.name_source).toBe("json-ld")
  })

  it("og:site_name wins over application-name and title when no JSON-LD name", () => {
    const html = `
      <head>
        <title>Some Page | Home</title>
        <meta name="application-name" content="AppName">
        <meta property="og:site_name" content="Bright Electric">
      </head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Bright Electric")
    expect(out.name_source).toBe("og:site_name")
  })

  it("application-name wins over title when no JSON-LD / og:site_name", () => {
    const html = `
      <head>
        <title>Welcome | Home</title>
        <meta name="application-name" content="Riverside Dental">
      </head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Riverside Dental")
    expect(out.name_source).toBe("application-name")
  })

  it("falls back to a cleaned <title> when nothing else is present", () => {
    const html = `<head><title>Green Valley Landscaping | Home</title></head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Green Valley Landscaping")
    expect(out.name_source).toBe("title")
  })

  it("matches meta content regardless of attribute order", () => {
    const html = `<head><meta content="Order Flipped Co" property="og:site_name"></head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Order Flipped Co")
  })

  it("decodes HTML entities in the name", () => {
    const html = `<head><meta property="og:site_name" content="Ben &amp; Jerry Paving"></head>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Ben & Jerry Paving")
  })

  it("backfills description from og:description", () => {
    const html = `
      <head>
        <meta property="og:site_name" content="Acme">
        <meta property="og:description" content="We fix drains fast.">
      </head>`
    const out = extractSiteMetadata(html)
    expect(out.description).toBe("We fix drains fast.")
  })

  it("returns {} for null/empty html", () => {
    expect(extractSiteMetadata(null)).toEqual({})
    expect(extractSiteMetadata("")).toEqual({})
    expect(extractSiteMetadata(undefined)).toEqual({})
  })

  it("rescues an SPA whose body is empty but head has JSON-LD", () => {
    // Simulates a client-rendered SPA: no meaningful body, but SSR'd head.
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type":"Organization","name":"Roto-Rooter","telephone":"1-800-555-1234"}</script>
      </head><body><div id="root"></div></body></html>`
    const out = extractSiteMetadata(html)
    expect(out.name).toBe("Roto-Rooter")
    expect(out.phone).toBe("1-800-555-1234")
  })
})
