// SSRF guard for the Instant First Responder Demo (HIGH FIX H3b).
//
// /api/demo/start is PUBLIC and unauthed, and it fetches an arbitrary user-supplied
// URL server-side (fetchSite). Without a guard, an attacker can point it at internal
// infrastructure (169.254.169.254 cloud metadata, localhost admin ports, RFC1918
// hosts) and use our server as a proxy. fetchSite is SHARED with the real onboarding
// research route, so we do NOT change it — the demo path calls fetchSiteGuarded,
// which pre-flights the URL through this guard before delegating to fetchSite.
//
// Checks (pure, unit-tested):
//   1. scheme must be http/https,
//   2. host must not be an IP (or resolve to one) in a private/loopback/link-local
//      /unique-local range.
// DNS resolution + the actual body-size cap live in fetchSiteGuarded (I/O layer).

/** An IPv4 address as four octets, or null if not a dotted-quad IPv4 literal. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const octets = m.slice(1, 5).map((s) => Number(s))
  if (octets.some((o) => o < 0 || o > 255)) return null
  return octets as [number, number, number, number]
}

/**
 * True when an IPv4 address is in a range we must never fetch server-side:
 *   0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local, incl. the
 *   cloud metadata endpoint 169.254.169.254), 172.16/12, 192.0.0/24, 192.168/16.
 */
export function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && octets[1] === 0 && octets[2] === 0) return true // 192.0.0/24
  return false
}

/**
 * True when an IPv6 literal (no brackets) is loopback (::1), unspecified (::),
 * link-local (fe80::/10), unique-local (fc00::/7), or an IPv4-mapped address whose
 * embedded v4 is private. Best-effort textual check (no full parser needed for the
 * ranges that matter for SSRF).
 */
export function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "::1" || h === "::") return true
  // Link-local fe80::/10 and unique-local fc00::/7 (fc../fd..).
  if (/^fe[89ab]/.test(h)) return true
  if (/^f[cd]/.test(h)) return true
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) {
    const v4 = parseIpv4(mapped[1])
    return v4 ? isPrivateIpv4(v4) : true
  }
  return false
}

/** True when a resolved IP literal (v4 or v6) is in a blocked private range. */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIpv4(ip)
  if (v4) return isPrivateIpv4(v4)
  return isPrivateIpv6(ip)
}

export type UrlCheck =
  | { ok: true; hostname: string; isIpLiteral: boolean }
  | { ok: false; reason: string }

/**
 * Static (no-DNS) SSRF pre-check on a URL string. Rejects non-http(s) schemes and
 * hostnames that are already private-IP literals. When the host is a NAME, returns
 * ok:true with isIpLiteral:false so the I/O layer knows it must still resolve DNS
 * and re-check each resolved address before connecting.
 */
export function checkUrlForSsrf(rawUrl: string): UrlCheck {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "invalid URL" }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `blocked scheme: ${u.protocol}` }
  }
  const hostname = u.hostname.replace(/^\[|\]$/g, "")
  if (hostname === "") return { ok: false, reason: "empty host" }
  if (hostname.toLowerCase() === "localhost") {
    return { ok: false, reason: "blocked host: localhost" }
  }

  const isIpLiteral = parseIpv4(hostname) !== null || hostname.includes(":")
  if (isIpLiteral && isPrivateIp(hostname)) {
    return { ok: false, reason: `blocked private IP: ${hostname}` }
  }
  return { ok: true, hostname, isIpLiteral }
}
