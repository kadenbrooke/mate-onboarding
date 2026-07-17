import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"

const DEFAULT_COLORS = { primary: "#1f2937", bg: "#ffffff", accent: "#2563eb" }

export function normalizeUrl(input: string): string {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = "https://" + u
  return u.replace(/\/+$/, "")
}

function resolve(base: string, href: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

export interface Brand {
  logo_url: string | null
  colors: { primary: string; bg: string; accent: string }
}

export function extractBrandFromHtml(html: string, baseUrl: string): Brand {
  const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").trim()
  const logoRaw =
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
  const themeColor = pick(
    /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,8})["']/i
  )
  return {
    logo_url: logoRaw ? resolve(baseUrl, logoRaw) : null,
    colors: { ...DEFAULT_COLORS, ...(themeColor ? { primary: themeColor } : {}) },
  }
}

export async function fetchSite(
  url: string
): Promise<{ html: string | null; finalUrl: string }> {
  const finalUrl = normalizeUrl(url)
  try {
    const res = await fetch(finalUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { html: null, finalUrl }
    return { html: await res.text(), finalUrl }
  } catch {
    return { html: null, finalUrl }
  }
}

export interface CompanyData {
  name?: string
  services?: string[]
  hours?: string
  service_area?: string
  phone?: string
  about?: string
}

export async function extractCompanyData(html: string | null): Promise<CompanyData> {
  if (!html) return {}
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 8000)
  try {
    const { text: json } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Extract company info as JSON with keys name, services (array), hours, service_area, phone, about. Text:\n${text}\nReturn ONLY JSON.`,
    })
    return JSON.parse(json.replace(/```json|```/g, "").trim())
  } catch {
    return {}
  }
}
