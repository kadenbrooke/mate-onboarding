import { describe, it, expect } from 'vitest';
import { parseOutcomeBody, parsePaymentBody, parseDollarsToCents, centsToInput, MAX_JOB_CENTS } from './outcome';

describe('parseOutcomeBody', () => {
  it('accepts a won job with a sold price', () => {
    expect(parseOutcomeBody({ outcome: 'won', job_value_cents: 500000 })).toEqual({
      ok: true, values: { job_outcome: 'won', job_value_cents: 500000, lost_reason: null },
    });
  });

  it('accepts a won job with nothing entered yet', () => {
    expect(parseOutcomeBody({ outcome: 'won' })).toEqual({
      ok: true, values: { job_outcome: 'won', job_value_cents: null, lost_reason: null },
    });
  });

  it('accepts a lost job, trimming the reason and dropping a blank one', () => {
    expect(parseOutcomeBody({ outcome: 'lost', lost_reason: ' price ' })).toMatchObject({ ok: true, values: { lost_reason: 'price' } });
    expect(parseOutcomeBody({ outcome: 'lost', lost_reason: '   ' })).toMatchObject({ ok: true, values: { lost_reason: null } });
  });

  it('null clears everything', () => {
    expect(parseOutcomeBody({ outcome: null })).toEqual({
      ok: true, values: { job_outcome: null, job_value_cents: null, lost_reason: null },
    });
  });

  it('rejects what the 0021 CHECKs would reject', () => {
    const bad = [
      null, 'won', {}, { outcome: 'serviced' }, { outcome: 'won', job_value_cents: -5 },
      { outcome: 'won', job_value_cents: 1.5 }, { outcome: 'won', job_value_cents: '100' },
      { outcome: 'won', job_value_cents: MAX_JOB_CENTS + 1 },
      // cash is a payment, never a total on the outcome
      { outcome: 'won', collected_cents: 100 },
      { outcome: 'lost', job_value_cents: 100 }, { outcome: 'won', lost_reason: 'x' },
      { outcome: 'lost', lost_reason: 'x'.repeat(201) }, { outcome: 'lost', lost_reason: 5 },
    ];
    for (const b of bad) expect(parseOutcomeBody(b).ok, JSON.stringify(b)).toBe(false);
  });
});

describe('parsePaymentBody', () => {
  const NOW = new Date('2026-10-07T18:00:00.000Z');

  it('takes signed whole cents and an ISO date, defaulting the date to now', () => {
    expect(parsePaymentBody({ amount_cents: 100000, paid_at: '2026-09-01T18:00:00Z' }, NOW)).toEqual({
      ok: true, values: { amount_cents: 100000, paid_at: '2026-09-01T18:00:00.000Z' },
    });
    expect(parsePaymentBody({ amount_cents: -2500 }, NOW)).toEqual({
      ok: true, values: { amount_cents: -2500, paid_at: NOW.toISOString() },
    });
  });

  it('allows a day of clock slack for "today" but no future dates', () => {
    expect(parsePaymentBody({ amount_cents: 1, paid_at: '2026-10-08T12:00:00Z' }, NOW).ok).toBe(true);
    expect(parsePaymentBody({ amount_cents: 1, paid_at: '2026-10-09T12:00:00Z' }, NOW).ok).toBe(false);
  });

  it('rejects what the 0021 amount CHECK would reject', () => {
    for (const b of [
      null, {}, { amount_cents: 0 }, { amount_cents: 1.5 }, { amount_cents: '100' },
      { amount_cents: MAX_JOB_CENTS + 1 }, { amount_cents: -(MAX_JOB_CENTS + 1) },
      { amount_cents: 1, paid_at: 'last tuesday' }, { amount_cents: 1, paid_at: 5 },
      { amount_cents: 1, paid_at: '1999-12-31T00:00:00Z' },
    ]) expect(parsePaymentBody(b, NOW).ok, JSON.stringify(b)).toBe(false);
  });
});

describe('money input', () => {
  it('parses what an office assistant types', () => {
    expect(parseDollarsToCents('4250')).toEqual({ ok: true, cents: 425000 });
    expect(parseDollarsToCents('$4,250.50')).toEqual({ ok: true, cents: 425050 });
    expect(parseDollarsToCents(' 4250.5 ')).toEqual({ ok: true, cents: 425050 });
    expect(parseDollarsToCents('.75')).toEqual({ ok: true, cents: 75 });
    expect(parseDollarsToCents('')).toEqual({ ok: true, cents: null });
  });

  it('rejects anything ambiguous', () => {
    for (const s of ['-5', '4.255', 'abc', '4 250', '1e5', '99999999']) {
      expect(parseDollarsToCents(s).ok, s).toBe(false);
    }
  });

  it('round-trips cents to the box', () => {
    expect(centsToInput(425050)).toBe('4250.50');
    expect(centsToInput(425000)).toBe('4250');
    expect(centsToInput(5)).toBe('0.05');
    expect(centsToInput(null)).toBe('');
  });
});
