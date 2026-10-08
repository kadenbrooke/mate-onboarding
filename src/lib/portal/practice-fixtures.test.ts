import { describe, expect, it } from 'vitest';
import {
  buildPracticeLeads,
  buildPracticeMessages,
  PRACTICE_SESSION_ID,
} from '../../../scripts/practice-fixtures.mjs';

describe('practice CRM fixtures', () => {
  const leads = buildPracticeLeads('2026-10-07T15:30:00.000Z');

  it('contains only fake Utah contacts across the CRM funnel', () => {
    expect(PRACTICE_SESSION_ID).toBe('cccccccc-0000-4000-8000-000000000003');
    expect(leads.length).toBeGreaterThanOrEqual(12);
    expect(new Set(leads.map(l => l.source))).toEqual(new Set(['meta', 'web_form', 'google', 'referral']));
    expect(new Set(leads.map(l => l.status))).toEqual(new Set(['open', 'booked', 'quoted', 'serviced']));
    expect(leads.some(l => l.job_outcome === 'won')).toBe(true);
    expect(leads.some(l => l.job_outcome === 'lost')).toBe(true);
    for (const lead of leads) {
      expect(lead.phone).toMatch(/^\+180155501\d{2}$/);
      expect(lead.email).toMatch(/@example\.com$/);
      expect(lead.address).toMatch(/, UT \d{5}$/);
    }
  });

  it('contains inbound replies and provider-free fake outbound receipts', () => {
    const messages = buildPracticeMessages(leads, '2026-10-07T15:30:00.000Z');
    expect(messages.some((m: { direction: string; author: string }) => m.direction === 'inbound' && m.author === 'lead')).toBe(true);
    expect(messages.some((m: { direction: string; body: string }) => m.direction === 'outbound' && m.body.startsWith('[Practice fake sent'))).toBe(true);
  });
});
