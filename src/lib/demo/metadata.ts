// Deterministic structured-metadata extraction for the Instant First Responder
// Demo (reliability Layer 1, upgrade A).
//
// WHY: the demo's flakiness came from leaning on an LLM read of stripped body
// text. That intermittently returns no name on thin/SSR pages and ALWAYS returns
// nothing on client-rendered SPAs (their body is empty until JS runs). But almost
// every real site — SPAs included — server-renders machine-readable identity in
// the HTML <head>: JSON-LD Schema.org, OpenGraph, and standard meta tags. Parsing
// those deterministically (no model, no network) gives us a high-confidence
// business name (and often services/description/phone/address) BEFORE we ever ask
// the LLM, and rescues SPAs the body-text extractor can't see.
//
// PURE + non-throwing: takes already-fetched HTML, returns a partial profile.
// Never throws (a malformed JSON-LD blob must not 500 the demo). The values here
// are still UNTRUSTED (prospect-controlled site) — they flow through the same
// sanitize/fence clamp in fr-config.ts before reaching any prompt.

/**
 * What deterministic head-parsing can yield. All fields optional (a given page
 * may expose any subset). `description` maps onto CompanyData.about at merge time
 * (CompanyData has no `description` key of its own).
 */
export interface SiteMetadata {
  name?: string
  description?: string
  services?: string[]
  phone?: string
  address?: string
  /** Where `name` came from, for logging/telemetry. */
  name_source?: "json-ld" | "og:site_name" | "application-name" | "title"
}

/**
 * Trailing boilerplate frequently appended to <title> / og:title that is NOT part
 * of the business name: "| Home", " - Official Site", " — Welcome", etc. We strip
 * the LAST such segment so "Acme Plumbing | Home" -> "Acme Plumbing" while leaving
 * a legitimately segmented name ("Bob's | Best Pizza") mostly intact (only a
 * boilerplate tail is removed, and only when it matches the noise vocabulary).
 */
const TITLE_NOISE_TAIL =
  /\s*[|\-–—:·]\s*(home|homepage|official site|official website|welcome|welcome!?|home page)\s*$/i

// A general "Name <sep> Tagline" split. Titles very often read
// "Business Name | Tagline goes here" or "Business Name - We do X". When the head
// gives us nothing better, the FIRST segment before a separator is the best guess
// at the business name. Applied ONLY as the lowest-precedence fallback (title),
// never over JSON-LD / og:site_name which are already clean names.
const TITLE_SEPARATORS = /\s+[|\-–—·]\s+/

/**
 * Clean a raw <title> or og:title into a best-guess business name:
 *   1. strip a trailing boilerplate segment ("| Home", "- Official Site", ...),
 *   2. if a separator remains, take the leading segment (the name, not tagline).
 * Returns "" for empty/whitespace input.
 */
export function cleanTitle(raw: string | undefined | null): string {
  if (!raw) return ""
  let t = raw.replace(/\s+/g, " ").trim()
  if (t === "") return ""
  // Strip a trailing boilerplate tail (may repeat, e.g. "X | Home | Welcome").
  let prev: string
  do {
    prev = t
    t = t.replace(TITLE_NOISE_TAIL, "").trim()
  } while (t !== prev && t !== "")
  if (t === "") return ""
  // If a separator still remains, the business name is the leading segment.
  const parts = t.split(TITLE_SEPARATORS)
  if (parts.length > 1) {
    const lead = parts[0].trim()
    if (lead !== "") return lead
  }
  return t
}

/** First capture group of the first matching tag, trimmed. "" when no match. */
function pick(html: string, re: RegExp): string {
  return (html.match(re)?.[1] ?? "").trim()
}

/** Decode the small set of HTML entities common in head metadata. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#0*38;/g, "&")
    .replace(/&nbsp;/g, " ")
}

/**
 * Meta content is order-insensitive: the `property`/`name` attribute can appear
 * before OR after `content`. Match either order for a given key.
 */
function metaContent(html: string, attr: "property" | "name", key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const after = new RegExp(
    `<meta[^>]+${attr}=["']${esc}["'][^>]*\\bcontent=["']([^"']*)["']`,
    "i"
  )
  const before = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${esc}["']`,
    "i"
  )
  const v = pick(html, after) || pick(html, before)
  return v ? decodeEntities(v) : ""
}

// --- JSON-LD -----------------------------------------------------------------

// Schema.org @types we accept as a business identity. LocalBusiness has many
// subtypes (Plumber, HVACBusiness, Electrician, Restaurant, ...); we accept any
// @type whose name contains one of these tokens, plus the generic org/site types.
const ORG_TYPE_TOKENS = [
  "organization",
  "localbusiness",
  "business",
  "store",
  "website",
  "corporation",
  "professionalservice",
  "homeandconstructionbusiness",
  "contractor",
]

function typeMatches(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  return types.some((t) => {
    if (typeof t !== "string") return false
    const low = t.toLowerCase()
    return ORG_TYPE_TOKENS.some((tok) => low.includes(tok))
  })
}

// @types that are DEFINITELY not a business identity — reject even if they carry
// a name/phone (a Person can have a telephone; a BreadcrumbList never is a biz).
const NON_ORG_TYPE_TOKENS = [
  "breadcrumb",
  "person",
  "article",
  "blogposting",
  "webpage",
  "product",
  "faqpage",
  "itemlist",
  "searchaction",
]

function typeIsNonOrg(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  return types.every((t) => {
    if (typeof t !== "string") return false
    const low = t.toLowerCase()
    return NON_ORG_TYPE_TOKENS.some((tok) => low.includes(tok))
  })
}

/** Pull a string name off a JSON-LD node (`name`, or `legalName`). */
function nodeName(node: Record<string, unknown>): string {
  const n = node.name ?? node.legalName
  return typeof n === "string" ? n.trim() : ""
}

/** Coerce a JSON-LD phone/address/description field to a clean string. */
function asString(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (v && typeof v === "object") {
    // PostalAddress -> streetAddress + locality; fall back to any string field.
    const o = v as Record<string, unknown>
    const parts = [o.streetAddress, o.addressLocality, o.addressRegion, o.postalCode]
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .map((x) => x.trim())
    if (parts.length) return parts.join(", ")
  }
  return ""
}

/** Extract service names from makesOffer / hasOfferCatalog / department nodes. */
function offerServices(node: Record<string, unknown>): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim())
  }
  const walkOffer = (offer: unknown) => {
    if (!offer || typeof offer !== "object") return
    const o = offer as Record<string, unknown>
    // Offer.itemOffered.name, Offer.name, or Service.name
    push(o.name)
    const item = o.itemOffered
    if (item && typeof item === "object") push((item as Record<string, unknown>).name)
  }
  const makes = node.makesOffer
  if (Array.isArray(makes)) makes.forEach(walkOffer)
  else if (makes) walkOffer(makes)

  const catalog = node.hasOfferCatalog
  const catalogItems =
    catalog && typeof catalog === "object"
      ? (catalog as Record<string, unknown>).itemListElement
      : undefined
  if (Array.isArray(catalogItems)) catalogItems.forEach(walkOffer)

  const dept = node.department
  if (Array.isArray(dept)) {
    dept.forEach((d) => {
      if (d && typeof d === "object") push((d as Record<string, unknown>).name)
    })
  }
  // De-dupe, cap generously (final MAX_SERVICES clamp happens in sanitize).
  return [...new Set(out)].slice(0, 16)
}

/**
 * Recursively collect candidate org/business nodes from a parsed JSON-LD value.
 * JSON-LD comes in many shapes: a single node, an array of nodes, or an
 * `@graph` wrapper. We flatten all of them and keep nodes whose @type matches.
 */
function collectOrgNodes(value: unknown, acc: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectOrgNodes(v, acc))
    return
  }
  if (!value || typeof value !== "object") return
  const node = value as Record<string, unknown>
  if (Array.isArray(node["@graph"])) {
    collectOrgNodes(node["@graph"], acc)
  }
  if (nodeName(node) === "") return
  if (typeIsNonOrg(node["@type"])) return
  // Accept if the @type is a known org/business token OR the node carries strong
  // business-identity signal (name + contact/offer). The signal branch catches the
  // ~70 LocalBusiness subtypes (Plumber, Electrician, Dentist, ...) that share no
  // common substring with our token list.
  const hasBizSignal =
    node.telephone != null ||
    node.address != null ||
    node.makesOffer != null ||
    node.hasOfferCatalog != null
  if (typeMatches(node["@type"]) || hasBizSignal) {
    acc.push(node)
  }
}

/**
 * Parse all JSON-LD blocks and return the best org/business identity found.
 * Precedence among matched nodes: a LocalBusiness-ish node with a name wins over
 * a bare WebSite node (a WebSite's `name` is often just the site title). We rank
 * by whether the node looks like a real business (has phone/address/offers).
 */
export function parseJsonLd(html: string): SiteMetadata {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ].map((m) => m[1])

  const nodes: Record<string, unknown>[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    try {
      collectOrgNodes(JSON.parse(trimmed), nodes)
    } catch {
      // Malformed JSON-LD (common in the wild) — skip this block, never throw.
    }
  }
  if (nodes.length === 0) return {}

  // Rank: prefer a node that looks like a concrete business (has contact/offer
  // signal) over a bare WebSite node whose `name` is really the site title.
  const score = (n: Record<string, unknown>) => {
    let s = 0
    const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]
    const isWebsiteOnly = types.every(
      (t) => typeof t === "string" && t.toLowerCase() === "website"
    )
    if (!isWebsiteOnly) s += 4
    if (n.telephone) s += 2
    if (n.address) s += 2
    if (n.makesOffer || n.hasOfferCatalog || n.department) s += 1
    return s
  }
  nodes.sort((a, b) => score(b) - score(a))
  const best = nodes[0]

  const services = offerServices(best)
  const phone = asString(best.telephone)
  const address = asString(best.address)
  const description = asString(best.description)

  return {
    name: nodeName(best),
    name_source: "json-ld",
    ...(services.length ? { services } : {}),
    ...(phone ? { phone } : {}),
    ...(address ? { address } : {}),
    ...(description ? { description } : {}),
  }
}

// --- Public entry ------------------------------------------------------------

/**
 * Deterministically extract identity metadata from a page's HTML head.
 *
 * business-name precedence (spec upgrade A):
 *   JSON-LD name > og:site_name > <meta application-name> > cleaned <title>.
 * Only the FIRST source that yields a non-empty name sets `name` (+ name_source).
 * description/services/phone/address are merged best-effort from whatever source
 * has them (JSON-LD is richest; og:description backfills description).
 *
 * Never throws. Returns {} when the head yields nothing usable.
 */
export function extractSiteMetadata(html: string | null | undefined): SiteMetadata {
  if (!html) return {}

  const jsonLd = parseJsonLd(html)

  const ogSiteName = decodeEntities(metaContent(html, "property", "og:site_name"))
  const ogTitle = decodeEntities(metaContent(html, "property", "og:title"))
  const ogDescription = decodeEntities(
    metaContent(html, "property", "og:description")
  )
  const applicationName = decodeEntities(
    metaContent(html, "name", "application-name")
  )
  const metaDescription = decodeEntities(metaContent(html, "name", "description"))
  const rawTitle = decodeEntities(pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i))

  // Resolve business name by precedence.
  let name = ""
  let name_source: SiteMetadata["name_source"] | undefined
  if (jsonLd.name && jsonLd.name.trim() !== "") {
    name = jsonLd.name.trim()
    name_source = "json-ld"
  } else if (ogSiteName !== "") {
    name = ogSiteName
    name_source = "og:site_name"
  } else if (applicationName !== "") {
    name = applicationName
    name_source = "application-name"
  } else {
    // Cleaned <title>, then cleaned og:title as a last resort for the name.
    const fromTitle = cleanTitle(rawTitle) || cleanTitle(ogTitle)
    if (fromTitle !== "") {
      name = fromTitle
      name_source = "title"
    }
  }

  const description = jsonLd.description || ogDescription || metaDescription || undefined

  const out: SiteMetadata = {}
  if (name !== "") {
    out.name = name
    out.name_source = name_source
  }
  if (description) out.description = description
  if (jsonLd.services?.length) out.services = jsonLd.services
  if (jsonLd.phone) out.phone = jsonLd.phone
  if (jsonLd.address) out.address = jsonLd.address
  return out
}
