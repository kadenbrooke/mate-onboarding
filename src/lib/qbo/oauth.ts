// src/lib/qbo/oauth.ts
//
// Pure OAuth request builders for QBO. Nothing here touches the network: each
// function returns a URL string or a request DESCRIPTOR (url/method/headers/
// body). The actual outbound fetch happens on the KVM2 n8n rail (Intuit's
// production keys require a static whitelisted egress IP, which Vercel
// serverless does not have). Keeping the builders pure means they unit-test
// without a network and the rail and any local tool share one source of truth.

import { QBO_SCOPE } from './config';

/** HTTP request descriptor -- what to send, not the sending. */
export type QboRequest = {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  /** x-www-form-urlencoded body, already serialized. */
  body: string;
};

/** Basic auth header value for the token endpoint: base64(clientId:clientSecret). */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  // Buffer exists in the Node runtime these routes/rail run on.
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

/**
 * Build the Intuit authorization URL the user's browser is redirected to. The
 * `state` is an opaque, signed CSRF token (see qbo/state.ts) echoed back to the
 * callback. `authorizationEndpoint` comes from the discovery doc.
 */
export function buildAuthorizeUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope ?? QBO_SCOPE);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

/**
 * Build the authorization-code -> tokens exchange request. Called on the rail.
 * Body is form-encoded per Intuit's spec; client credentials go in the Basic
 * auth header, never the body.
 */
export function buildTokenExchangeRequest(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): QboRequest {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  }).toString();
  return {
    url: params.tokenEndpoint,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
    },
    body,
  };
}

/**
 * Build the refresh-token -> new tokens request. QBO ROTATES the refresh token
 * on every refresh (the response carries a NEW refresh_token). The rail MUST
 * persist that new token or the connection dies at the next refresh; the
 * rotation itself is handled in qbo/tokens.ts.
 */
export function buildRefreshRequest(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): QboRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  }).toString();
  return {
    url: params.tokenEndpoint,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
    },
    body,
  };
}

/** Intuit sends a per-request trace id in the `intuit_tid` response header.
 *  Capture it on every call and log it -- Intuit support triages by tid. */
export function extractIntuitTid(headers: Headers | Record<string, string>): string | null {
  if (headers instanceof Headers) return headers.get('intuit_tid');
  return headers['intuit_tid'] ?? headers['Intuit_Tid'] ?? null;
}
