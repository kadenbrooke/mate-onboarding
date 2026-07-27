// Scrape -> company profile for the Instant First Responder Demo.
//
// Reliability (Layer 1): extraction is now a TWO-source merge, deterministic
// FIRST, LLM SECOND:
//   A. extractSiteMetadata() parses machine-readable identity out of the HTML head
//      (JSON-LD Schema.org, OpenGraph, meta, <title>) with NO model call. This is
//      the high-confidence source for business_name and rescues client-rendered
//      SPAs whose body is empty until JS runs but which still SSR their head.
//   B. extractCompanyDataViaPortkey() reads the stripped body text with the cheap
//      Portkey model, as before.
// mergeExtracted() combines them: the deterministic head name takes PRECEDENCE
// over the LLM name (spec: JSON-LD > og:site_name > application-name > <title> >
// LLM), while services/phone/etc. backfill from whichever source has them.
//
// Reuses the provider-agnostic scraper (fetchSite) but routes the LLM extraction
// through the thin Portkey client (decision b). Same JSON contract as CompanyData
// so buildFrConfig consumes it unchanged. Cheapest model that clears the bar per
// .claude/rules/model-agnostic.md.
//
// Non-throwing: a bot-walled site or a model failure yields {} so the funnel can
// still produce a (thin-site fallback) persona rather than 500.
import type { CompanyData } from "@/lib/research/website"
import { chatComplete } from "./portkey"
import { extractSiteMetadata, type SiteMetadata } from "./metadata"

const EXTRACT_PROMPT = [
  "Extract company info from the website text below as a single JSON object.",
  "Keys (all optional, omit if truly unknown):",
  "  name: string",
  "  services: string[] (the services/offerings the business provides)",
  "  hours: string (business hours, human-readable)",
  "  service_area: string (cities/regions served)",
  "  phone: string",
  "  email: string",
  "  address: string (full street address if present)",
  "Do not invent values. Return ONLY the JSON object, no prose, no code fences.",
].join("\n")

// A short list of generic/junk "names" that are NOT a real business identity.
// A <title> can degrade to one of these on a thin or misconfigured page, and the
// LLM sometimes echoes them; treat them as no-name so we don't build a persona
// around "Home" or "Welcome".
const GENERIC_NAME_RE =
  /^(home|homepage|home page|welcome|welcome!?|index|untitled|new (site|page|tab)|loading|this business|website|site)$/i

/**
 * True when `name` is a real, usable business name (not empty, not a generic
 * placeholder like "Home"/"Welcome"/"this business"). This is the single gate the
 * route uses to decide whether it must retry — keep it here so the parser, the
 * merge, and the retry logic all agree on what "no real name" means.
 */
export function isUsableName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false
  const t = name.trim()
  if (t === "") return false
  return !GENERIC_NAME_RE.test(t)
}

/**
 * Merge deterministic head metadata (A) with the LLM body extraction (B).
 *
 * business-name precedence:
 *   1. A HIGH-CONFIDENCE metadata name (JSON-LD / og:site_name / application-name)
 *      wins outright — it is a machine-readable, SSR-reliable clean name.
 *   2. A <title>-DERIVED metadata name is only a guess (the name may be the second
 *      segment, e.g. "Plumbing ... | Mr. Rooter Plumbing"), so a USABLE LLM name
 *      (which reads the whole page) wins over it.
 *   3. Otherwise fall back to the title-derived name, then the LLM name.
 * Other fields backfill: prefer the LLM's richer body-derived value, else meta.
 */
export function mergeExtracted(
  meta: SiteMetadata,
  llm: CompanyData
): CompanyData {
  const metaName = isUsableName(meta.name) ? meta.name!.trim() : ""
  const llmName = isUsableName(llm.name) ? llm.name!.trim() : ""
  const metaIsHighConfidence = metaName !== "" && meta.name_source !== "title"

  const name = metaIsHighConfidence
    ? metaName // JSON-LD / og:site_name / application-name: trust outright.
    : llmName || metaName || undefined // title-derived defers to a usable LLM name.

  const services =
    llm.services && llm.services.length > 0
      ? llm.services
      : meta.services && meta.services.length > 0
        ? meta.services
        : undefined

  return {
    ...llm,
    // Always overwrite name (to `name`, possibly undefined) so a non-usable LLM
    // name like "" or "Home" that the spread carried in can't leak through.
    name,
    ...(services ? { services } : {}),
    ...(llm.phone || meta.phone ? { phone: llm.phone || meta.phone } : {}),
    ...(llm.address || meta.address ? { address: llm.address || meta.address } : {}),
    ...(llm.about || meta.description
      ? { about: llm.about || meta.description }
      : {}),
  }
}

/**
 * Extract CompanyData from raw page HTML via the Portkey extract model. Strips
 * scripts/styles/tags, caps to 8k chars (same budget as the shared extractor),
 * then asks the cheap model for a JSON profile. Never throws; returns {} on any
 * failure so the caller can fall through to thin-site persona defaults.
 */
export async function extractCompanyDataViaPortkey(
  html: string | null
): Promise<CompanyData> {
  if (!html) return {}
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 8000)

  const raw = await chatComplete({
    taskClass: "extract",
    messages: [{ role: "user", content: `${EXTRACT_PROMPT}\n\nWebsite text:\n${text}` }],
    maxTokens: 500,
  })
  if (!raw) return {}

  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as CompanyData
  } catch {
    return {}
  }
}

/**
 * Full demo-path extraction for a page: deterministic head metadata FIRST, then
 * the LLM body extraction, merged with head-name precedence. This is the single
 * entry the demo route calls per fetch attempt. Never throws.
 */
export async function extractCompanyProfile(
  html: string | null
): Promise<CompanyData> {
  const meta = extractSiteMetadata(html)
  const llm = await extractCompanyDataViaPortkey(html)
  return mergeExtracted(meta, llm)
}
