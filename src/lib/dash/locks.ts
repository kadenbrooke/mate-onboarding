// Lock evaluation for dashboard zones.
//
// A zone is locked when the client has not yet supplied what it needs. State is
// derived at render time from signals already on the session row: there is no
// lock table and no status column to keep in sync.
//
// Pure by design (no React, no Supabase) so it is unit testable in isolation,
// matching the convention in src/lib/portal/capabilities.ts.

export type ZoneCta = {
  label: string;
  href: string;
  /** Secondary treatment: the client cannot self-serve this one. */
  secondary?: boolean;
};

/**
 * A lock is one of two kinds, set explicitly here (never inferred by the
 * view):
 * - 'action'      the client can do something right now to unlock the zone
 *                 (connect an account, add a phone number, flip a switch).
 *                 Renders the red MISSING INFO body with its CTA.
 * - 'coming-soon' nothing for the client to do; the feature is not live yet
 *                 for any client. Renders the muted COMING SOON cover, no CTA.
 */
export type ZoneLockKind = 'action' | 'coming-soon';

export type ZoneLock = {
  kind: ZoneLockKind;
  reason: string;
  cta?: ZoneCta;
};

/** Zones that derive purely from client_leads and need no connection. */
export const ALWAYS_LIVE_ZONES = [
  'zone-leadflow',
  'zone-speed',
  'zone-pipeline',
  'zone-journey',
] as const;

/** Zones that gate on a signal. */
export const GATED_ZONES = [
  'zone-calendar',
  'zone-reputation',
  'zone-followup',
  'zone-operations',
  'zone-ads',
  'zone-money',
] as const;

export type ZoneId = (typeof ALWAYS_LIVE_ZONES)[number] | (typeof GATED_ZONES)[number];

export type LockInput = {
  sessionId: string;
  collected: Record<string, unknown> | null;
  agentEnabled: boolean;
  operatorPhone: string | null;
  /** True when ad_metrics rows exist for this session. */
  adsPresent: boolean;
  /** True when qb_metrics rows exist for this session (QBO connected + pulled). */
  moneyPresent: boolean;
};

/** Human labels, used by the setup checklist and the MISSING INFO card. */
export const ZONE_LABELS: Record<ZoneId, string> = {
  'zone-leadflow': 'Lead flow',
  'zone-speed': 'Speed to lead',
  'zone-pipeline': 'Pipeline',
  'zone-journey': 'Lead journey',
  'zone-calendar': 'Calendar',
  'zone-reputation': 'Reputation',
  'zone-followup': 'Follow-up engine',
  'zone-operations': 'Operations',
  'zone-ads': 'Ad performance',
  'zone-money': 'Revenue',
};

/**
 * Client-friendly "what this is, what it will do" sentences, used by the
 * COMING SOON cover (ComingSoon.tsx). Covers every zone, not only the ones
 * currently rendered as coming-soon, so moving a zone between the 'action'
 * and 'coming-soon' kinds later never leaves a description to write.
 */
export const ZONE_DESCRIPTIONS: Record<ZoneId, string> = {
  'zone-leadflow': 'Every lead as it comes in, scored and sorted by how hot it is.',
  'zone-speed': 'How fast your team responds to a new lead, and how many missed calls get rescued.',
  'zone-pipeline': 'Where every job stands right now: won, open, or lost.',
  'zone-journey': 'The path each lead takes from first contact to close.',
  'zone-calendar': 'Every booked job, pulled straight from your Google Calendar so you always know what is on the schedule.',
  'zone-reputation': 'Your Google reviews and referral requests in one place, so you can see what customers are saying and who they are sending your way.',
  'zone-followup': 'The Reactivator follows up automatically with old leads and past customers who went quiet, then shows you who came back and what it recovered.',
  'zone-operations': 'Your crew, their assigned numbers, and your AI assistant activity, tracked in one operations view.',
  'zone-ads': 'Your ad spend and cost per lead across every campaign, pulled straight from your ad accounts once we connect them for you.',
  'zone-money': 'Revenue, collections, and unpaid invoices pulled straight from QuickBooks.',
};

export function zoneLocks(input: LockInput): Record<ZoneId, ZoneLock | null> {
  const googleConnected = input.collected?.google_connected === true;
  const phoneSet = (input.operatorPhone ?? '').trim().length > 0;

  const googleCta: ZoneCta = {
    label: 'Connect Google',
    href: `/api/connect/google?sessionId=${input.sessionId}`,
  };
  // No settings surface exists for these two, so the action is to ask in the
  // assistant chat, which is a real page and reaches a real person.
  const askCta = (label: string): ZoneCta => ({
    label,
    href: `/dash/${input.sessionId}/assistant`,
  });

  const locks: Record<ZoneId, ZoneLock | null> = {
    'zone-leadflow': null,
    'zone-speed': null,
    'zone-pipeline': null,
    'zone-journey': null,

    'zone-calendar': googleConnected ? null : {
      kind: 'action',
      reason: 'We need your Google account to show your booked jobs.',
      cta: googleCta,
    },
    'zone-reputation': googleConnected ? null : {
      kind: 'action',
      reason: 'We need your Google account to pull your reviews.',
      cta: googleCta,
    },
    'zone-followup': input.agentEnabled ? null : {
      kind: 'action',
      reason: 'Your assistant is switched off, so nothing is following up yet.',
      cta: askCta('Turn on assistant'),
    },
    'zone-operations': phoneSet ? null : {
      kind: 'action',
      reason: 'Add the phone number a real person should be reached at.',
      cta: askCta('Add phone number'),
    },
    // Meta config is a single set of env vars shared by the whole app, so there
    // is no per-session account for a client to connect, and no client action
    // unlocks it either: we wire it up on our side. That makes this a
    // 'coming-soon' lock, not an 'action' one -- no CTA, just what it will do.
    'zone-ads': input.adsPresent ? null : {
      kind: 'coming-soon',
      reason: "Your ad account isn't linked yet. We do this for you, so get in touch and we'll wire it up.",
    },
    // QBO is a per-client OAuth connection the client authorizes once. Unlike
    // Meta (shared app env), there IS a self-serve action here: connect
    // QuickBooks. Unlocks when the first pull lands qb_metrics rows.
    'zone-money': input.moneyPresent ? null : {
      kind: 'action',
      reason: 'Connect QuickBooks to see your revenue, collections, and unpaid invoices here.',
      cta: { label: 'Connect QuickBooks', href: `/api/qb/connect?sessionId=${input.sessionId}` },
    },
  };

  return locks;
}
