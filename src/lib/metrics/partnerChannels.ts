// src/lib/metrics/partnerChannels.ts
//
// WHICH LEAD SOURCES COUNT AS PARTNER CHANNELS. The one place this is decided.
//
// The draft growth-partner agreement pays the partner a share of cash ACTUALLY
// COLLECTED from every current and legacy lead source. The sole exception is a
// self_sourced deal (door knock / cold call) that was serviced without the AI
// texting agent. The source is selected at intake; revenue.ts and the SQL view
// apply the message-sent condition for that exception.
//
// The prior-12-month customer caveat remains outside this app: Mate has no
// record of the client's prior customers, so the estimate does not compute it.

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
  // All current and legacy sources count toward the basis.
  meta: 'partner',
  call: 'partner',
  text: 'partner',
  referral: 'partner',
  google: 'partner',
  typed: 'partner',
  lead_snapshot: 'partner',
  web_form: 'partner',
  revived: 'partner',
  missed_call: 'partner',
  texted_in: 'partner',
  self_sourced: 'partner',
  unknown: 'partner',
};

/** Owner of a source string; anything unmapped is the company's. */
export function channelOwner(source: string): ChannelOwner {
  return (PARTNER_CHANNEL_SOURCES as Record<string, ChannelOwner>)[source] ?? 'company';
}

/** The partner share of a cash amount, whole cents, rounded half up. */
export function partnerShareCents(collectedCents: number, bps = PARTNER_SHARE_BPS): number {
  return Math.round((collectedCents * bps) / 10000);
}
