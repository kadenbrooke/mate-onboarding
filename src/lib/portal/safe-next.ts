// Validates a post-login ?next= value. Only same-origin path navigations
// survive: URL parsing (not string matching) defeats backslash and
// whitespace normalization tricks like "/\evil.com" or "/\t/evil.com".
export function safeNextPath(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith("/")) return null;
  let parsed: URL;
  try {
    parsed = new URL(next, origin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  return parsed.pathname + parsed.search;
}
