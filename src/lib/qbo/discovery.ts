// src/lib/qbo/discovery.ts
//
// Resolve Intuit's live OAuth endpoints from the OpenID discovery document
// (per the DEL-10 brief: don't hardcode). The discovery doc is a PUBLIC,
// unauthenticated metadata file -- it is not the IP-restricted API surface, so
// fetching it from Vercel is fine. The IP-restricted calls (token exchange,
// refresh, and the data pull) all go through the KVM2 rail; only the
// authorization ENDPOINT resolved here is used, and only to build the URL the
// user's own browser is redirected to.
//
// On any fetch failure we fall back to Intuit's documented endpoints so a
// transient metadata outage cannot break the connect flow, and we surface which
// path was taken so a real endpoint change is visible in logs.

import { QBO_DISCOVERY_URL, QBO_FALLBACK_ENDPOINTS, type QbEnvironment } from './config';

export type QboEndpoints = {
  authorization_endpoint: string;
  token_endpoint: string;
  source: 'discovery' | 'fallback';
};

type DiscoveryDoc = { authorization_endpoint?: string; token_endpoint?: string };

export async function resolveEndpoints(
  environment: QbEnvironment,
  timeoutMs = 8_000,
): Promise<QboEndpoints> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(QBO_DISCOVERY_URL[environment], {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`discovery ${res.status}`);
    const doc = (await res.json()) as DiscoveryDoc;
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error('discovery doc missing endpoints');
    }
    return {
      authorization_endpoint: doc.authorization_endpoint,
      token_endpoint: doc.token_endpoint,
      source: 'discovery',
    };
  } catch {
    return {
      authorization_endpoint: QBO_FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: QBO_FALLBACK_ENDPOINTS.token_endpoint,
      source: 'fallback',
    };
  } finally {
    clearTimeout(timer);
  }
}
