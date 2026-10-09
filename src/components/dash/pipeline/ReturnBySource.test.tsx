import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnBySource } from './ReturnBySource';
import { summarizeReturn, type SourceRevenueRow } from '@/lib/metrics/revenue';

// Invented practice numbers only.
const row = (source: string, over: Partial<SourceRevenueRow> = {}): SourceRevenueRow => ({
  source, leads: 0, won: 0, lost: 0, job_value_cents: 0, collected_cents: 0,
  collected_in_window_cents: 0, collected_30d_cents: 0, ...over,
});

describe('ReturnBySource', () => {
  it('shows each source\'s return and the 15% basis from every source', () => {
    const summary = summarizeReturn([
      row('meta', { leads: 4, won: 1, job_value_cents: 640000, collected_cents: 320000, collected_in_window_cents: 320000, collected_30d_cents: 320000 }),
      row('call', { leads: 2, won: 1, job_value_cents: 900000, collected_cents: 900000, collected_in_window_cents: 900000 }),
    ], { metaSpend30dCents: 80000 });
    render(<ReturnBySource summary={summary} sessionId="s1" />);

    expect(screen.getByTestId('return-meta').textContent).toContain('4 leads · 1 won (25%)');
    expect(screen.getByTestId('return-meta').textContent).toContain('$3,200');
    expect(screen.getByTestId('return-meta').textContent).toContain('PARTNER');
    expect(screen.getByTestId('return-call').textContent).toContain('PARTNER');
    expect(screen.getByTestId('return-meta-30d').textContent).toContain('$800 spent, $3,200 collected');
    expect(screen.getByTestId('return-meta-30d').textContent).toContain('(4.0x)');

    const basis = screen.getByTestId('return-partner-basis').textContent ?? '';
    expect(basis).toContain('ESTIMATE');
    expect(basis).toContain('$1,830');
    expect(basis).toContain('15% of');
    expect(basis).toContain('collected from partner channels');
    expect(basis).toContain('Meta Ads, Call');
    expect(basis).toMatch(/does not yet exclude customers/i);
    // Most cash first.
    expect(screen.getAllByTestId(/^return-(meta|call)$/).map(e => e.dataset.testid)).toEqual(['return-call', 'return-meta']);
  });

  it('asks for outcomes before any are entered, and hides Meta spend without ad data', () => {
    render(<ReturnBySource summary={summarizeReturn([row('text', { leads: 3 })])} sessionId="s1" />);
    expect(screen.getByRole('link', { name: /open the pipeline/i })).toHaveAttribute('href', '/dash/s1/pipeline');
    expect(screen.queryByTestId('return-meta-30d')).toBeNull();
    expect(screen.getByTestId('return-partner-basis').textContent).toContain('$0');
  });

  it('carries no em dashes', () => {
    const { container } = render(<ReturnBySource summary={summarizeReturn([row('meta', { leads: 1 })], { metaSpend30dCents: 100 })} sessionId="s1" />);
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
  });
});
