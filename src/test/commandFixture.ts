// Practice data for the Command Center: invented people, 555 numbers, made-up
// jobs. Used by CommandCenter.test.tsx and for review screenshots. Never put
// real lead data here.

import type { Lead } from '@/lib/metrics/leads';
import { summarizeReturn, type SourceRevenueRow } from '@/lib/metrics/revenue';
import { buildCommandModel, type CommandModel, type LeadSignal } from '@/lib/command/commandCenter';
import { leadLabel } from '@/components/dash/leads/leadName';

export const PRACTICE_NOW = new Date('2026-10-07T15:30:00.000Z');
const h = (hours: number) => new Date(PRACTICE_NOW.getTime() - hours * 3_600_000).toISOString();
const d = (days: number) => h(days * 24);

const base: Omit<Lead, 'id' | 'name' | 'phone'> = {
  city: 'Orem', service: 'Driveway', source: 'meta', referrer_name: null, score: null, status: 'open',
  quote_cents: null, handler: 'agent', contacted: true, after_hours: false, first_reply_seconds: null,
  created_at: d(9), job_outcome: null, job_value_cents: null,
};
const L = (id: string, name: string, last4: string, over: Partial<Lead> = {}): Lead =>
  ({ ...base, id, name, phone: `+1801555${last4}`, ...over });

export const PRACTICE_LEADS: Lead[] = [
  L('p1', 'Dana Whitfield', '0141', { score: 91, quote_cents: 1_450_000, city: 'Lindon', created_at: d(2) }),
  L('p2', 'Marco Ruiz', '0172', { score: 84, city: 'Provo', service: 'Parking lot', created_at: h(20) }),
  L('p3', 'Priya Natarajan', '0118', { score: 77, city: 'Lehi', service: 'Sealcoat', created_at: d(4) }),
  L('p4', 'Owen Castell', '0190', { score: 68, city: 'Sandy', service: 'Patch', handler: 'human', handler_changed_at: d(6), created_at: d(6) }),
  L('p5', 'Hailey Brandt', '0133', { score: 63, city: 'Orem', created_at: d(8), status: 'booked' }),
  L('p6', 'Theo Lindqvist', '0155', { score: 58, city: 'Payson', created_at: h(3), source: 'google' }),
  L('p7', 'Rosa Delgado', '0164', { score: 49, city: 'Spanish Fork', created_at: h(7), source: 'call', handler: 'human', handler_changed_at: h(7) }),
  L('p8', 'Grant Okafor', '0127', { score: 45, city: 'Ogden', status: 'quoted', status_updated_at: d(19), quote_cents: 620_000 }),
  L('p9', 'Lena Fairbanks', '0109', { score: 40, city: 'Draper', status: 'quoted', status_updated_at: d(26), quote_cents: 380_000 }),
  L('p10', 'Cal Henning', '0186', { status: 'serviced', job_outcome: 'won', job_value_cents: 940_000, source: 'referral' }),
  L('p11', 'Bea Thornton', '0193', { status: 'booked', job_outcome: 'won', job_value_cents: 610_000 }),
  L('p12', 'Ike Sorensen', '0145', { status: 'serviced', job_outcome: 'won', job_value_cents: 480_000 }),
];

export const PRACTICE_SIGNALS: LeadSignal[] = [
  { lead_id: 'p1', score: 91, tier: '1', timeframe: 'asap', last_lead_reply_at: h(1.5) },
  { lead_id: 'p2', score: 84, tier: '1', timeframe: 'next week', last_lead_reply_at: h(5) },
  { lead_id: 'p3', score: 77, tier: '1', timeframe: 'within a month', last_lead_reply_at: d(2) },
  { lead_id: 'p4', score: 68, tier: '2', timeframe: null, last_lead_reply_at: h(2) },
  { lead_id: 'p5', score: 63, tier: '1', timeframe: null, last_lead_reply_at: null },
  { lead_id: 'p6', score: 58, tier: '1', timeframe: null, last_lead_reply_at: null },
  { lead_id: 'p7', score: 49, tier: '1', timeframe: null, last_lead_reply_at: null },
];

/** Payments recorded per won lead (p11 still owes, p12 partly paid). */
export const PRACTICE_PAID = new Map([['p10', 940_000], ['p11', 0], ['p12', 240_000]]);

const PRACTICE_SOURCES: SourceRevenueRow[] = [
  { source: 'meta', leads: 38, won: 4, lost: 6, job_value_cents: 2_890_000, collected_cents: 1_960_000, collected_in_window_cents: 1_960_000, collected_30d_cents: 720_000 },
  { source: 'referral', leads: 6, won: 2, lost: 1, job_value_cents: 1_420_000, collected_cents: 1_420_000, collected_in_window_cents: 0, collected_30d_cents: 0 },
  { source: 'google', leads: 9, won: 1, lost: 2, job_value_cents: 520_000, collected_cents: 260_000, collected_in_window_cents: 260_000, collected_30d_cents: 260_000 },
  { source: 'call', leads: 12, won: 0, lost: 3, job_value_cents: 0, collected_cents: 0, collected_in_window_cents: 0, collected_30d_cents: 0 },
];

export function practiceModel(sessionId = 'practice'): CommandModel {
  return buildCommandModel({
    sessionId,
    openLeads: PRACTICE_LEADS.filter(l => l.status !== 'serviced' && l.job_outcome == null),
    wonLeads: PRACTICE_LEADS.filter(l => l.job_outcome === 'won'),
    complete: { open: true, won: true },
    signals: new Map(PRACTICE_SIGNALS.map(s => [s.lead_id, s])),
    // Owen texted after the last answer; nobody has answered him yet.
    lastOutbound: new Map([['p4', h(4)]]),
    paidByLead: PRACTICE_PAID,
    summary: summarizeReturn(PRACTICE_SOURCES, { metaSpend30dCents: 210_000 }),
    now: PRACTICE_NOW,
    label: leadLabel,
  });
}
