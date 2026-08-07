// src/lib/qbo/tokens.ts
//
// Token rotation + expiry logic -- the #1 failure mode of a QBO integration and
// therefore the most heavily unit-tested piece (see tokens.test.ts).
//
// QBO's token model:
//   - access_token:  ~1 hour TTL (response `expires_in`, seconds).
//   - refresh_token: ~100 day life (`x_refresh_token_expires_in`, seconds), BUT
//     it ROTATES on every refresh -- each refresh response returns a NEW
//     refresh_token. If you keep using the old one, the next refresh fails and
//     the connection is permanently dead. So EVERY token response, exchange or
//     refresh, must persist the refresh_token it returned.
//
// All pure: no network, no DB. `applyTokenResponse` maps a raw Intuit token
// response into the exact column set qb_connections stores, computing absolute
// expiry timestamps from a caller-supplied `now` so tests are deterministic.

/** Raw token response from Intuit's token endpoint (exchange or refresh). */
export type QboTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // access token TTL, seconds
  x_refresh_token_expires_in?: number; // refresh token remaining life, seconds
  token_type?: string; // "bearer"
};

/** The token-bearing columns of a qb_connections row. */
export type QbConnectionTokens = {
  access_token: string;
  access_token_expires_at: string; // ISO 8601
  refresh_token: string;
  refresh_token_expires_at: string | null; // ISO 8601, null if Intuit omits it
};

/** Default clock skew: refresh a little BEFORE the token actually expires so an
 *  in-flight request never races the expiry boundary. */
export const ACCESS_TOKEN_SKEW_SECONDS = 60;

/**
 * Map an Intuit token response into the columns qb_connections persists.
 *
 * CRITICAL: `refresh_token` is taken from the RESPONSE (the freshly rotated
 * one), never carried over from the prior connection. This single line is the
 * difference between a connection that lives 100 days and one that dies at the
 * first refresh.
 */
export function applyTokenResponse(
  resp: QboTokenResponse,
  now: Date = new Date(),
): QbConnectionTokens {
  const base = now.getTime();
  const accessExpiresAt = new Date(base + resp.expires_in * 1000).toISOString();
  const refreshExpiresAt =
    typeof resp.x_refresh_token_expires_in === 'number'
      ? new Date(base + resp.x_refresh_token_expires_in * 1000).toISOString()
      : null;
  return {
    access_token: resp.access_token,
    access_token_expires_at: accessExpiresAt,
    refresh_token: resp.refresh_token, // <-- the rotated token; persist it
    refresh_token_expires_at: refreshExpiresAt,
  };
}

/**
 * Whether the access token is expired (or missing, or within the skew window)
 * as of `now`. A null/empty expiry counts as expired so a never-populated
 * connection triggers a refresh rather than sending a blank bearer.
 */
export function isAccessTokenExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
  skewSeconds: number = ACCESS_TOKEN_SKEW_SECONDS,
): boolean {
  if (!expiresAt) return true;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return true;
  return now.getTime() + skewSeconds * 1000 >= expiryMs;
}

/** Whether the refresh token itself has expired (100-day hard stop). When true
 *  the client must re-authorize -- no refresh can recover it. */
export function isRefreshTokenExpired(
  refreshExpiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!refreshExpiresAt) return false; // unknown -> assume still valid, let the API 400 decide
  const expiryMs = Date.parse(refreshExpiresAt);
  if (Number.isNaN(expiryMs)) return false;
  return now.getTime() >= expiryMs;
}

/**
 * Decide what the pull should do with a connection's current tokens.
 *   'ok'         -> access token still valid, use it.
 *   'refresh'    -> access token expired, refresh it (persist the rotation).
 *   'reconnect'  -> refresh token dead, needs a fresh OAuth consent.
 */
export function tokenAction(
  conn: { access_token_expires_at: string | null; refresh_token: string | null; refresh_token_expires_at: string | null },
  now: Date = new Date(),
): 'ok' | 'refresh' | 'reconnect' {
  if (!conn.refresh_token) return 'reconnect';
  if (isRefreshTokenExpired(conn.refresh_token_expires_at, now)) return 'reconnect';
  if (isAccessTokenExpired(conn.access_token_expires_at, now)) return 'refresh';
  return 'ok';
}
