import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReferralAttribution } from './ReferralAttribution';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'lead', name: 'Customer', city: null, service: null, phone: null, source: 'referral',
  referrer_name: 'Partner One', score: null, status: 'open', quote_cents: null,
  contacted: false, after_hours: false, first_reply_seconds: null,
  created_at: '2026-10-16T00:00:00Z', ...over,
});

describe('ReferralAttribution', () => {
  it('shows referral totals grouped by the referrer on the dashboard', () => {
    render(<ReferralAttribution leads={[lead({ id: 'a' }), lead({ id: 'b' }), lead({ id: 'c', referrer_name: 'Partner Two' }), lead({ id: 'd', source: 'google' })]} />);
    expect(screen.getByTestId('referral-attribution')).toHaveTextContent('3 referred leads');
    expect(screen.getByTestId('referral-attribution')).toHaveTextContent('Partner One');
    expect(screen.getByTestId('referral-attribution')).toHaveTextContent('2');
    expect(screen.getByTestId('referral-attribution')).toHaveTextContent('Partner Two');
  });

  it('makes missing attribution visible rather than hiding the referral', () => {
    render(<ReferralAttribution leads={[lead({ referrer_name: null })]} />);
    expect(screen.getByTestId('referral-attribution')).toHaveTextContent('Unattributed referral');
  });
});

