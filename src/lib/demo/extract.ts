// Scrape -> company profile for the Instant First Responder Demo.
//
// Reuses the provider-agnostic scraper (fetchSite) but routes the extraction
// model call through the thin Portkey client (decision b) instead of the inline
// gpt-4o-mini call in src/lib/research/website.ts::extractCompanyData. Same JSON
// contract as CompanyData so buildFrConfig consumes it unchanged. Cheapest model
// that clears the bar (extract task class) per .claude/rules/model-agnostic.md.
//
// Non-throwing: a bot-walled site or a model failure yields {} so the funnel can
// still produce a (thin-site fallback) persona rather than 500.
import type { CompanyData } from "@/lib/research/website"
import { chatComplete } from "./portkey"

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
