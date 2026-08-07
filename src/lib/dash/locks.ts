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

export type ZoneLock = {
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
      reason: 'We need your Google account to show your booked jobs.',
      cta: googleCta,
    },
    'zone-reputation': googleConnected ? null : {
      reason: 'We need your Google account to pull your reviews.',
      cta: googleCta,
    },
    'zone-followup': input.agentEnabled ? null : {
      reason: 'Your assistant is switched off, so nothing is following up yet.',
      cta: askCta('Turn on assistant'),
    },
    'zone-operations': phoneSet ? null : {
      reason: 'Add the phone number a real person should be reached at.',
      cta: askCta('Add phone number'),
    },
    // Meta config is a single set of env vars shared by the whole app, so there
    // is no per-session account for a client to connect. This zone unlocks when
    // ad data lands, and offers contact rather than a control that does nothing.
    'zone-ads': input.adsPresent ? null : {
      reason: "Your ad account isn't linked yet. We do this for you, so get in touch and we'll wire it up.",
      cta: { label: 'Contact us', href: `/dash/${input.sessionId}/assistant`, secondary: true },
    },
    // QBO is a per-client OAuth connection the client authorizes once. Unlike
    // Meta (shared app env), there IS a self-serve action here: connect
    // QuickBooks. Unlocks when the first pull lands qb_metrics rows.
    'zone-money': input.moneyPresent ? null : {
      reason: 'Connect QuickBooks to see your revenue, collections, and unpaid invoices here.',
      cta: { label: 'Connect QuickBooks', href: `/api/qb/connect?sessionId=${input.sessionId}` },
    },
  };

  return locks;
}
