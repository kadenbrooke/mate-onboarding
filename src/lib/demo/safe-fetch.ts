// The one way Mate fetches a URL it did not choose (a site a caller typed, or a
// logo, stylesheet or manifest that site's HTML points at).
//
// Every hop is checked before connecting: http/https only, no private, loopback,
// link-local (cloud metadata) or unique-local literal (./ssrf), and the hostname
// is resolved and EVERY address re-checked, so a public name pointing at an
// internal range is refused too. Redirects are followed by hand, up to
// maxRedirects, and each Location goes through the same checks, so a public page
// cannot bounce the server into the internal network.
//
// Known limit: the address is resolved here and again by fetch, so a host that
// changes its answer between the two (DNS rebinding with a zero TTL) is not
// fully closed. Pinning the resolved address would need a custom dispatcher.
//
// Never throws: a refusal is { res: null, blocked: true, reason }, a network
// failure { res: null }.

import { lookup } from "node:dns/promises"
import { checkUrlForSsrf, isPrivateIp } from "./ssrf"

export interface SafeFetchResult {
  /** The final response (any status), or null when refused or unreachable. */
  res: Response | null
  /** The URL that produced `res` (after redirects), or the one refused. */
  finalUrl: string
  blocked?: boolean
  reason?: string
}

/** Why a URL may not be fetched, or null when it may. Static checks, then DNS. */
export async function refuseUrl(url: string): Promise<string | null> {
  const check = checkUrlForSsrf(url)
  if (!check.ok) return check.reason
  if (check.isIpLiteral) return null
  try {
    const addrs = await lookup(check.hostname, { all: true })
    if (addrs.length === 0) return "host did not resolve"
    const bad = addrs.find(a => isPrivateIp(a.address))
    return bad ? `host resolves to private IP: ${bad.address}` : null
  } catch {
    return "DNS resolution failed"
  }
}

export async function safeFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  opts: { maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const { timeoutMs = 8000, ...rest } = init
  const maxRedirects = opts.maxRedirects ?? 3
  let current = url
  for (let hop = 0; ; hop++) {
    const reason = await refuseUrl(current)
    if (reason) return { res: null, finalUrl: current, blocked: true, reason }

    let res: Response
    try {
      res = await fetch(current, { ...rest, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      return { res: null, finalUrl: current }
    }

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!location) return { res, finalUrl: current }
    if (hop >= maxRedirects) return { res: null, finalUrl: current, blocked: true, reason: "too many redirects" }
    try {
      current = new URL(location, current).href
    } catch {
      return { res: null, finalUrl: current, blocked: true, reason: "invalid redirect" }
    }
  }
}
