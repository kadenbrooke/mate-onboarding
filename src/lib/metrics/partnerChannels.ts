// src/lib/metrics/partnerChannels.ts
//
// WHICH LEAD SOURCES COUNT AS PARTNER CHANNELS. The one place this is decided.
//
// The draft growth-partner agreement (unsigned as of 2026-10-06) pays the
// partner a share of cash ACTUALLY COLLECTED from Partner Channels:
//   * partner-run ads (Meta, Google, Nextdoor),
//   * partner-built sites, forms, chat and instant quote,
//   * partner reactivation and referral campaigns.
// The company's own channels are excluded. So is anyone who was on a quote,
// job or invoice in the prior 12 months, which Mate cannot see and therefore
// does NOT compute (see revenue.ts).
//
// Each client_leads.source maps to 'partner' or 'company'. The default leans
// toward 'company' wherever the source alone cannot prove the partner brought
// the lead in, so the estimate under-claims rather than over-claims. Changing
// a mapping is a founder decision, not a code cleanup: the open questions are
// marked OPEN below.

import type { Lead } from './leads';

export type ChannelOwner = 'partner' | 'company';

/** The share rate, in basis points (1500 = 15%). Draft agreement figure. */
export const PARTNER_SHARE_BPS = 1500;

/** Months after first contact during which collected cash counts (draft
 *  agreement). Mirrors the interval in migration 0021's view. */
export const PARTNER_WINDOW_MONTHS = 24;

/**
 * Lead source -> channel owner. Typed over every source the app knows, so a
 * new source cannot ship without someone deciding which side it is on.
 */
export const PARTNER_CHANNEL_SOURCES: Record<Lead['source'], ChannelOwner> = {
  // Partner-run Meta ads (lead forms and the Meta poller).
  meta: 'partner',
  // The partner-built web intake (J&C's site form / instant quote posts as
  // web_form).
  web_form: 'partner',
  // The Reactivator re-engaging a dormant customer: a partner reactivation
  // campaign. OPEN: only demo rows carry it today.
  revived: 'partner',
  // OPEN: 'google' does not say whether it was a partner-run Google ad or the
  // company's own Google Business Profile / organic search. No Google ads run
  // today (no Google ad_metrics rows), so it stays the company's.
  google: 'company',
  // OPEN: a plain referral is the company's word of mouth. A partner referral
  // CAMPAIGN would count, but the source does not distinguish them.
  referral: 'company',
  // The company's own phone line and texts, and leads typed or photographed in
  // by the company's own people.
  call: 'company',
  text: 'company',
  typed: 'company',
  lead_snapshot: 'company',
  // Legacy and fallback values: no claim without evidence.
  missed_call: 'company',
  texted_in: 'company',
  unknown: 'company',
};

/** Owner of a source string; anything unmapped is the company's. */
export function channelOwner(source: string): ChannelOwner {
  return (PARTNER_CHANNEL_SOURCES as Record<string, ChannelOwner>)[source] ?? 'company';
}

/** The partner share of a cash amount, whole cents, rounded half up. */
export function partnerShareCents(collectedCents: number, bps = PARTNER_SHARE_BPS): number {
  return Math.round((collectedCents * bps) / 10000);
}
