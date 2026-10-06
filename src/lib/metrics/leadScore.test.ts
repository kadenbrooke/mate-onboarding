import { describe, it, expect } from 'vitest';
import {
  leadScore, cityTier, urgencyFor, proximityFor, freshnessFor, replyFor, valueFor,
  TIER1_CITIES, TIER2_CITIES, type LeadScoreInputs,
} from './leadScore';
import { scoreStats, type Lead } from './leads';

// All fixtures are invented. No real lead data.
const NOW = new Date('2026-10-06T18:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();

const base: LeadScoreInputs = {
  quote_cents: null, timeframe: null, city: null, name: null, phone: null,
  address: null, dimensions: null, created_at: ago(30), last_lead_reply_at: null,
};

describe('component scores (the Ranker, ported)', () => {
  it('value: neutral 0.3 with no quote, linear to a $25k cap', () => {
    expect(valueFor(null)).toBe(0.3);
    expect(valueFor(0)).toBe(0.3);
    expect(valueFor(1250000)).toBe(0.5);
    expect(valueFor(9900000)).toBe(1);
  });

  it('urgency: the Ranker regexes, in the Ranker order', () => {
    expect(urgencyFor('ASAP please')).toBe(1.0);
    expect(urgencyFor('this week')).toBe(1.0);
    expect(urgencyFor('next week')).toBe(0.9);
    expect(urgencyFor('within 1 week')).toBe(0.9);
    expect(urgencyFor('2 weeks')).toBe(0.85);
    expect(urgencyFor('next month')).toBe(0.6);
    expect(urgencyFor('30 days')).toBe(0.6);
    expect(urgencyFor('a few weeks')).toBe(0.6);
    expect(urgencyFor('next spring')).toBe(0.3);
    expect(urgencyFor('next year')).toBe(0.3);
    // Far-off is checked before two weeks.
    expect(urgencyFor('more than 2 weeks out')).toBe(0.3);
    expect(urgencyFor('')).toBe(0.4);
    expect(urgencyFor(null)).toBe(0.4);
    expect(urgencyFor('whenever')).toBe(0.4);
  });

  it('tier: the First Responder city lists, case and whitespace insensitive, exact match', () => {
    expect(cityTier('Orem')).toBe(1);
    expect(cityTier('  saratoga springs ')).toBe(1);
    expect(cityTier('Sandy')).toBe(2);
    expect(cityTier('Ogden')).toBeNull();
    expect(cityTier('Orem, UT')).toBeNull();
    expect(cityTier(null)).toBeNull();
    for (const c of TIER1_CITIES) expect(cityTier(c)).toBe(1);
    for (const c of TIER2_CITIES) expect(cityTier(c)).toBe(2);
  });

  it('proximity: tier first, then any city at all, then nothing', () => {
    expect(proximityFor(1, 'Orem')).toBe(1.0);
    expect(proximityFor(2, 'Sandy')).toBe(0.7);
    expect(proximityFor(3, 'x')).toBe(0.5);
    expect(proximityFor(8, 'x')).toBe(0.1);
    expect(proximityFor(null, 'Ogden')).toBe(0.4);
    expect(proximityFor(null, '  ')).toBe(0.3);
    expect(proximityFor(null, null)).toBe(0.3);
  });

  it('freshness by lead age', () => {
    expect(freshnessFor(ago(1), NOW)).toBe(1.0);
    expect(freshnessFor(ago(2), NOW)).toBe(1.0);
    expect(freshnessFor(ago(6), NOW)).toBe(0.7);
    expect(freshnessFor(ago(10), NOW)).toBe(0.4);
    expect(freshnessFor(ago(40), NOW)).toBe(0.2);
  });

  it('reply by last inbound text from the lead; never replied is 0', () => {
    expect(replyFor(null, NOW)).toBe(0);
    expect(replyFor(ago(0.5), NOW)).toBe(1.0);
    expect(replyFor(ago(2), NOW)).toBe(0.8);
    expect(replyFor(ago(5), NOW)).toBe(0.6);
    expect(replyFor(ago(10), NOW)).toBe(0.4);
    expect(replyFor(ago(30), NOW)).toBe(0.2);
  });
});

describe('leadScore', () => {
  it('scores an empty, month-old lead on the neutral floors', () => {
    // 100 x (0.24*0.3 + 0.20*0.4 + 0.16*0.3 + 0.12*0.2 + 0 + 0) = 22.4
    expect(leadScore(base, NOW)).toBe(22);
  });

  it('scores a perfect lead 100', () => {
    expect(leadScore({
      quote_cents: 3000000, timeframe: 'asap', city: 'Orem', name: 'Test Lead',
      phone: '+15550000001', address: '1 Test St', dimensions: '20x30',
      created_at: ago(0.1), last_lead_reply_at: ago(0.1),
    }, NOW)).toBe(100);
  });

  it('is an integer clamped to 0..100', () => {
    for (const q of [null, 1, 500000, 99999999]) {
      const s = leadScore({ ...base, quote_cents: q, last_lead_reply_at: ago(1) }, NOW);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('decays as the clock moves, which is why it is computed at read time', () => {
    const lead = { ...base, created_at: ago(1), last_lead_reply_at: ago(0.5) };
    const later = new Date(NOW.getTime() + 20 * 86400000);
    expect(leadScore(lead, later)).toBeLessThan(leadScore(lead, NOW));
  });
});

describe('a new inbound text from the lead moves it up the ranking', () => {
  // Two invented leads. "quiet" is the bigger, closer job and starts on top;
  // "texter" then texts back and should overtake it on the Hot Leads card.
  const quiet: LeadScoreInputs = {
    ...base, quote_cents: 1500000, city: 'Provo', name: 'Quiet Lead', phone: '+15550000002',
    timeframe: 'next month', created_at: ago(4),
  };
  const texter: LeadScoreInputs = {
    ...base, quote_cents: 800000, city: 'Ogden', name: 'Texter Lead', phone: '+15550000003',
    timeframe: 'next month', created_at: ago(4),
  };
  const toLead = (id: string, i: LeadScoreInputs): Lead => ({
    id, name: i.name, city: i.city, service: null, phone: i.phone, source: 'text',
    referrer_name: null, score: leadScore(i, NOW), status: 'open', quote_cents: i.quote_cents,
    contacted: true, after_hours: false, first_reply_seconds: null, created_at: i.created_at,
  });

  it('ranks below before the reply and above after it', () => {
    const before = scoreStats([toLead('quiet', quiet), toLead('texter', texter)]).hot.map(l => l.id);
    expect(before).toEqual(['quiet', 'texter']);

    const replied = { ...texter, last_lead_reply_at: ago(0.01) };
    expect(leadScore(replied, NOW)).toBeGreaterThan(leadScore(texter, NOW));
    const after = scoreStats([toLead('quiet', quiet), toLead('texter', replied)]).hot.map(l => l.id);
    expect(after).toEqual(['texter', 'quiet']);
  });
});
