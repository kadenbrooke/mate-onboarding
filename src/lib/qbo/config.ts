// src/lib/qbo/config.ts
//
// QBO environment + endpoint resolution. Pure where it can be; env is read
// INSIDE functions (never at module scope) so `next build` never requires the
// secret to be present. Sandbox-first: everything defaults to sandbox and swaps
// to production via QBO_ENVIRONMENT, matching the DEL-10 brief.

export type QbEnvironment = 'sandbox' | 'production';

/** QBO Accounting API base URL, per environment. The daily pull hits
 *  `${base}/v3/company/{realmId}/...`. Selected by the connection's stored
 *  `environment`, NOT a global -- a sandbox connection must never read prod. */
export const QBO_API_BASE: Record<QbEnvironment, string> = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};

/** Intuit OpenID discovery documents. Fetched (not hardcoded) to resolve the
 *  live authorization + token endpoints; the well-known URLs themselves are the
 *  only stable anchor Intuit publishes. */
export const QBO_DISCOVERY_URL: Record<QbEnvironment, string> = {
  sandbox: 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration',
  production: 'https://developer.api.intuit.com/.well-known/openid_configuration',
};

/**
 * Documented fallback endpoints, used ONLY if the discovery fetch fails, so a
 * transient Intuit metadata outage cannot fully break the connect flow. These
 * are the same values Intuit's discovery doc returns today. Marked as fallback
 * so a mismatch is visible in logs rather than silent.
 */
export const QBO_FALLBACK_ENDPOINTS = {
  // The authorization endpoint is identical across sandbox/production; the
  // sandbox-ness of a connection is decided by the API base + the app keys.
  authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
  token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
} as const;

/** Read-only accounting scope. Read-only is enforced by the pull only ever
 *  issuing GETs; this scope is the least privilege QBO offers for reports. */
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

/** Resolve the active environment from env. Defaults to sandbox (production
 *  keys are pending Intuit approval). */
export function qboEnvironment(): QbEnvironment {
  return process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

export type QboOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QbEnvironment;
};

/**
 * Read + validate the OAuth app config. Throws a clear error when unset so the
 * connect/callback surfaces fail loudly instead of building a broken redirect.
 * clientSecret is only needed on the token-exchange rail; connect (authorize
 * URL) uses clientId + redirectUri only, so callers that never see the secret
 * can pass requireSecret=false.
 */
export function qboOAuthConfig(requireSecret = true): QboOAuthConfig {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET ?? '';
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment = qboEnvironment();
  if (!clientId || !redirectUri || (requireSecret && !clientSecret)) {
    throw new Error(
      'QBO OAuth config missing QBO_CLIENT_ID, QBO_REDIRECT_URI, or QBO_CLIENT_SECRET',
    );
  }
  return { clientId, clientSecret, redirectUri, environment };
}
