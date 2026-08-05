// src/lib/metrics/googleAdsFetch.ts
//
// Server-only: pull campaign stats for a client's Google Ads account. Sibling
// of adsFetch.ts (Meta) -- same split, network here and pure mapping in ads.ts,
// so the mapping tests never touch a socket.
//
// Auth shape differs from Meta in a way worth stating once:
//   - Meta: one long-lived page token, sent as a query param.
//   - Google: a developer token (identifies OUR app to Google), PLUS an OAuth2
//     refresh token exchanged for a short-lived access token on every call.
//     Google Ads does not accept service accounts, so a service-account key --
//     the thing that works for GA4 and Search Console -- is NOT usable here.
//
// Env is read inside the functions, never at module scope, so `next build`
// succeeds without any Google credentials present.

import type { GoogleAdsResponse } from './ads';

// Pinned deliberately. Google sunsets Ads API versions on a fixed schedule; a
// pinned version fails loudly on a known date instead of drifting silently.
const GOOGLE_ADS_API_VERSION = 'v18';

/**
 * Campaign-level stats for the last 30 days, matching the Meta pull's window
 * so the two platforms on the card cover the same period.
 *
 * segments.date is intentionally NOT selected: we want one aggregate row per
 * campaign for the window, mirroring Meta's level=campaign + date_preset.
 */
const GAQL = `
  SELECT
    campaign.id,
    campaign.name,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
    AND campaign.status != 'REMOVED'
`;

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // digits only, no dashes
  loginCustomerId?: string; // MCC id when the account is accessed via a manager
};

/** Strip formatting so callers can paste "195-691-5350" straight from the UI. */
function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Read the Google Ads env. Returns null (not a throw) when unconfigured, so the
 * refresh route can pull Meta successfully while Google is still waiting on a
 * developer token. A HALF-configured env is a different story -- that is a
 * mistake, not a state, so it throws.
 */
export function googleAdsConfig(): GoogleAdsConfig | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_JC_CUSTOMER_ID;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  const present = [developerToken, clientId, clientSecret, refreshToken, customerId].filter(Boolean);
  if (present.length === 0) return null; // cleanly not set up yet
  if (present.length < 5) {
    throw new Error(
      'Google Ads config is partially set. Need all of GOOGLE_ADS_DEVELOPER_TOKEN, ' +
      'GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, ' +
      'GOOGLE_ADS_JC_CUSTOMER_ID.',
    );
  }

  return {
    developerToken: developerToken!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    customerId: digitsOnly(customerId!),
    loginCustomerId: loginCustomerId ? digitsOnly(loginCustomerId) : undefined,
  };
}

/** Exchange the long-lived refresh token for a short-lived access token. */
async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google OAuth token exchange failed (${res.status}): ${json.error_description ?? json.error ?? 'unknown'}`,
    );
  }
  return json.access_token;
}

/**
 * Fetch campaign stats. Throws on any non-2xx so the caller surfaces the
 * failure rather than writing an empty snapshot that reads as "spend went to
 * zero" on the client's dashboard.
 */
export async function fetchGoogleAdsCampaigns(cfg: GoogleAdsConfig): Promise<GoogleAdsResponse> {
  const token = await accessToken(cfg);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  };
  // Required only when reaching the account through a manager (MCC) account.
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;

  const url =
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}` +
    `/customers/${cfg.customerId}/googleAds:searchStream`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: GAQL }),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API error (${res.status}): ${text.slice(0, 400)}`);
  }

  // searchStream returns an ARRAY of batches, each with its own `results`.
  // A single-object response is also valid for small result sets, so handle
  // both rather than assuming the array shape.
  const parsed = JSON.parse(text) as GoogleAdsResponse | GoogleAdsResponse[];
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return { results: batches.flatMap((b) => b.results ?? []) };
}
