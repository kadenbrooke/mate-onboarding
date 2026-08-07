// src/lib/qbo/rail.ts
//
// Client for the KVM2 n8n "QBO Live Proxy" -- the ONLY surface that talks to
// Intuit. Intuit's production keys require every API call to originate from a
// static, whitelisted egress IP (72.60.226.53, KVM2). Vercel serverless has no
// stable egress IP, so Vercel NEVER calls Intuit directly. This mirrors the
// Mercury Live Proxy (scripts/mercury-api.sh + MERCURY_BASE_URL).
//
// This module runs on Vercel (in /api/qb/callback) and forwards the OAuth
// authorization code to the rail's token-exchange webhook. The rail performs
// the exchange from the whitelisted IP, stores/rotates tokens in qb_connections,
// and returns a summary. The shared `x-proxy-secret` authenticates the caller;
// no Intuit client secret ever lives on Vercel's request path.
//
// Env (read inside the function so `next build` never needs it):
//   QBO_RAIL_EXCHANGE_URL  e.g. https://n8n.auto-mate.business/webhook/qbo-exchange
//   QBO_PROXY_SECRET       shared secret, sent as x-proxy-secret

export type RailExchangeInput = {
  sessionId: string;
  realmId: string;
  code: string;
  environment: 'sandbox' | 'production';
};

export type RailExchangeResult =
  | { ok: true; realmId: string }
  | { ok: false; error: string; status?: number };

/**
 * Ask the KVM2 rail to exchange an authorization code for tokens and store the
 * connection. Never throws -- returns a discriminated result so the callback
 * route can redirect with a clean error rather than a 500 stack trace.
 */
export async function requestTokenExchange(
  input: RailExchangeInput,
  timeoutMs = 20_000,
): Promise<RailExchangeResult> {
  const url = process.env.QBO_RAIL_EXCHANGE_URL;
  const secret = process.env.QBO_PROXY_SECRET;
  if (!url || !secret) {
    return { ok: false, error: 'QBO rail not configured (QBO_RAIL_EXCHANGE_URL / QBO_PROXY_SECRET)' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': secret,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: controller.signal,
    });
    // The rail returns JSON; tolerate a non-JSON error body.
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { error: text.slice(0, 200) };
    }
    if (!res.ok || json.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === 'string' ? json.error : `rail exchange failed (${res.status})`,
      };
    }
    return { ok: true, realmId: input.realmId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'rail request failed';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
