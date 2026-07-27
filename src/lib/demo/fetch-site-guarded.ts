// SSRF-guarded site fetch for the Instant First Responder Demo (HIGH FIX H3b).
//
// The demo's public /api/demo/start route must NOT be usable as an SSRF proxy into
// our own infrastructure. fetchSite (src/lib/research/website.ts) is shared with the
// authenticated onboarding research route, so we leave it untouched and route the
// PUBLIC demo path through this wrapper instead. It:
//   1. normalizes + statically screens the URL (scheme + literal-IP checks),
//   2. resolves the hostname and rejects if ANY resolved address is private
//      (defeats DNS-rebinding to internal ranges),
//   3. fetches with a hard body-size cap (fetchSite's await res.text() is unbounded).
// Returns the same { html, finalUrl } shape as fetchSite. Never throws.
import { lookup } from "node:dns/promises"
import { normalizeUrl } from "@/lib/research/website"
import { checkUrlForSsrf, isPrivateIp } from "./ssrf"

// Cap the fetched HTML so a hostile/huge response can't blow memory. The extractor
// only reads the first 8k chars of text anyway; 2MB of HTML is far more than enough.
const MAX_HTML_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 8000

// Default UA (bot-honest). The retry path passes a realistic browser UA instead,
// because some sites bot-wall or serve a thin/empty shell to obvious crawlers; a
// browser UA can get us the real SSR HTML on the second attempt.
const DEFAULT_UA = "Mozilla/5.0 (compatible; MateOnboarding/1.0)"
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export interface GuardedFetchResult {
  html: string | null
  finalUrl: string
  blocked?: boolean
  reason?: string
}

export interface FetchSiteGuardedOpts {
  /**
   * Use a realistic browser User-Agent instead of the bot-honest default. The
   * reliability retry path sets this: a first fetch that came back thin/empty may
   * have been bot-walled, and a browser UA can coax the real SSR HTML out.
   */
  browserUa?: boolean
}

/**
 * Fetch a user-supplied site URL with an SSRF guard + body cap. On any block or
 * failure returns { html: null } (with blocked/reason set when it was a security
 * rejection) so the caller falls through to thin-site persona defaults.
 */
export async function fetchSiteGuarded(
  url: string,
  opts: FetchSiteGuardedOpts = {}
): Promise<GuardedFetchResult> {
  const userAgent = opts.browserUa ? BROWSER_UA : DEFAULT_UA
  // normalizeUrl blindly prefixes https:// to anything lacking an http(s) scheme,
  // which would turn "file:///etc/passwd" into "https://file:///..." and sneak a
  // disallowed scheme past the check. So reject an EXPLICIT non-http(s) scheme on
  // the RAW input first.
  const rawScheme = url.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (rawScheme && rawScheme !== "http" && rawScheme !== "https") {
    return {
      html: null,
      finalUrl: url,
      blocked: true,
      reason: `blocked scheme: ${rawScheme}:`,
    }
  }

  const finalUrl = normalizeUrl(url)

  const check = checkUrlForSsrf(finalUrl)
  if (!check.ok) {
    return { html: null, finalUrl, blocked: true, reason: check.reason }
  }

  // Resolve DNS and re-check every address. A hostname that resolves to a private
  // IP (including deliberate DNS-rebinding) is blocked before we ever connect.
  if (!check.isIpLiteral) {
    try {
      const addrs = await lookup(check.hostname, { all: true })
      if (addrs.length === 0) {
        return { html: null, finalUrl, blocked: true, reason: "host did not resolve" }
      }
      const bad = addrs.find((a) => isPrivateIp(a.address))
      if (bad) {
        return {
          html: null,
          finalUrl,
          blocked: true,
          reason: `host resolves to private IP: ${bad.address}`,
        }
      }
    } catch {
      return { html: null, finalUrl, blocked: true, reason: "DNS resolution failed" }
    }
  }

  try {
    const res = await fetch(finalUrl, {
      headers: { "user-agent": userAgent },
      redirect: "manual", // don't follow redirects into internal ranges
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { html: null, finalUrl }

    // Body-size cap: stream and abort past MAX_HTML_BYTES.
    const html = await readCapped(res, MAX_HTML_BYTES)
    return { html, finalUrl }
  } catch {
    return { html: null, finalUrl }
  }
}

/** Read a response body as text, capped at maxBytes. Never throws. */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = res.body
  if (!body) {
    // No stream (edge/polyfill): fall back to text() but still cap the slice.
    try {
      const t = await res.text()
      return t.slice(0, maxBytes)
    } catch {
      return null
    }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        chunks.push(value)
        if (total >= maxBytes) {
          await reader.cancel().catch(() => {})
          break
        }
      }
    }
  } catch {
    return null
  }
  const merged = new Uint8Array(Math.min(total, maxBytes))
  let off = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, merged.length - off)
    if (take <= 0) break
    merged.set(c.subarray(0, take), off)
    off += take
  }
  return new TextDecoder().decode(merged)
}
