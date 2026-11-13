// Same-site redirect targets. Every ?next= the app writes (proxy, dash gate)
// and every one it follows (the login page), and every path the pinned-origin
// redirects build (src/lib/public-url.ts), goes through safeRelativePath.
//
// A value survives only when, as sent and after each of up to three rounds of
// percent-decoding, it starts with exactly one "/" (never "//" or "/\"), holds
// no backslash and no control character, and URL parsing keeps it on the same
// origin. So "https://evil.example", "//evil.example", "/\evil.example",
// "/\t/evil.example", "/%2F%2Fevil.example", "/%5Cevil.example" and
// "/%252F%252Fevil.example" are all refused. A nested return-to parameter in
// the query (next, returnTo, redirect, ...) must pass the same check, so
// "/login?next=https://evil.example" is refused as a whole.

const CONTROL = /\p{Cc}/u;
const MAX_DECODES = 3;
const MAX_LENGTH = 2048;
const BASE = "https://same-site.invalid";

// Query keys that name a place to send the browser next.
export const RETURN_TO_KEYS = ["next", "returnTo", "return_to", "redirect", "redirectTo", "redirect_to", "continue"] as const;

function plainPath(s: string): boolean {
  return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") && !CONTROL.test(s);
}

/** `input` as a normalized same-site path (pathname + search + hash), or null. */
export function safeRelativePath(input: unknown, depth = 0): string | null {
  if (typeof input !== "string" || input === "" || input.length > MAX_LENGTH || depth > 2) return null;
  let s = input;
  for (let round = 0; ; round += 1) {
    if (!plainPath(s)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return null;
    }
    if (decoded === s) break;
    if (round === MAX_DECODES) return null; // still encoded after three rounds: refuse
    s = decoded;
  }
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  for (const key of RETURN_TO_KEYS) {
    for (const value of url.searchParams.getAll(key)) {
      if (safeRelativePath(value, depth + 1) === null) return null;
    }
  }
  return url.pathname + url.search + url.hash;
}

/**
 * Validates a post-login ?next= value read from the URL. Only a same-site path
 * survives (safeRelativePath); `origin` is the page's own origin, which the
 * normalized path is resolved against by the caller's router.
 */
export function safeNextPath(next: string | null, origin: string): string | null {
  const path = safeRelativePath(next);
  if (path === null) return null;
  // Belt and braces: the normalized path must still resolve onto `origin`.
  try {
    return new URL(path, origin).origin === new URL(origin).origin ? path : null;
  } catch {
    return null;
  }
}

/** One path segment (a session id), encoded so it can add no "/", "?", "#" or "..". */
export function pathSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  return encoded === "." || encoded === ".." || encoded === "" ? "_" : encoded;
}
