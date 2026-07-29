// src/lib/metrics/adsFetch.ts
//
// Server-only: pull Meta Insights for J&C's ad account. Kept separate from the
// pure mapping in ads.ts so the mapping tests never touch the network and this
// network wrapper stays thin. Env is read inside the function (never at module
// scope) so `next build` does not require the token to be present.

import type { MetaInsightsResponse } from './ads';

const META_GRAPH_VERSION = 'v21.0';

const INSIGHT_FIELDS = [
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'clicks',
  'cpc',
  'ctr',
  'actions',
  'cost_per_action_type',
].join(',');

export type MetaConfig = { adAccount: string; token: string };

/** Read + validate the Meta env. Throws a clear error when unset. */
export function metaConfig(): MetaConfig {
  const adAccount = process.env.META_JC_AD_ACCOUNT;
  const token = process.env.META_JC_PAGE_TOKEN;
  if (!adAccount || !token) {
    throw new Error('Meta ads config missing META_JC_AD_ACCOUNT or META_JC_PAGE_TOKEN');
  }
  return { adAccount, token };
}

/**
 * Fetch campaign-level Insights for the last 30 days. Returns the parsed
 * response. Throws on a non-2xx or a Graph API error envelope so the caller can
 * surface the failure (no silent empty result).
 */
export async function fetchInsights(cfg: MetaConfig): Promise<MetaInsightsResponse> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.adAccount}/insights`);
  url.searchParams.set('fields', INSIGHT_FIELDS);
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('date_preset', 'last_30d');
  url.searchParams.set('access_token', cfg.token);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = (await res.json()) as MetaInsightsResponse & { error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(`Meta Insights error (${res.status}): ${json.error?.message ?? 'unknown'}`);
  }
  return json;
}
