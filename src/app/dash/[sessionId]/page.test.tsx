import { describe, expect, it, vi } from 'vitest';

const { accessMock, serviceMock, dashboardProps } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  serviceMock: vi.fn(),
  dashboardProps: { value: null as Record<string, unknown> | null },
}));

function query(data: unknown = [], count: number | null = 0) {
  const result = { data, count, error: null };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    is: () => chain,
    gte: () => chain,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/portal/dash-gate', () => ({ requireDashAccess: accessMock }));
vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: serviceMock };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/components/dash/DashboardView', () => ({
  DashboardView: (props: Record<string, unknown>) => {
    dashboardProps.value = props;
    return null;
  },
}));
vi.mock('@/lib/metrics/revenue', () => ({
  fetchMetaSpend30dCents: vi.fn(async () => null),
  fetchRevenueBySource: vi.fn(async () => [{
    source: 'self_sourced', leads: 1, won: 1, lost: 0, job_value_cents: 100000,
    collected_cents: 50000, collected_in_window_cents: 50000, collected_30d_cents: 0,
    partner_collected_in_window_cents: 50000,
  }]),
  summarizeReturn: vi.fn(() => ({
    rows: [{ source: 'self_sourced', owner: 'partner', leads: 1, won: 1, lost: 0, job_value_cents: 100000,
      collected_cents: 50000, collected_in_window_cents: 50000, collected_30d_cents: 0,
      partner_collected_in_window_cents: 50000, winRate: 100 }],
    totals: { leads: 1, won: 1, lost: 0, jobValueCents: 100000, collectedCents: 50000 },
    hasOutcomes: true,
    partner: { collectedCents: 50000, shareBps: 1500, shareCents: 7500, sources: ['self_sourced'] },
    meta: { spend30dCents: null, collected30dCents: 0, collectedCents: 0, returnPerDollar: null },
  })),
}));
vi.mock('@/lib/metrics/money', () => ({ fetchMoneyTotals: vi.fn(async () => null) }));
vi.mock('@/lib/metrics/crew', () => ({ activeAgentCount: vi.fn(() => 0) }));
vi.mock('@/lib/metrics/ads', () => ({ adTotals: vi.fn(() => null) }));
vi.mock('@/lib/dash/locks', () => ({ zoneLocks: vi.fn(() => ({})) }));
vi.mock('@/lib/dash/gate', () => ({ gateLockedZoneData: vi.fn((data: unknown) => data) }));
vi.mock('@/lib/leads/liveScores', () => ({
  fetchLiveScores: vi.fn(async () => []),
  mergeLiveScores: vi.fn((leads: unknown[]) => leads),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));

import DashPage from './page';

const session = {
  id: 'fake-session', mate_name: 'Practice Mate', contact_id: 'fake-contact', collected: {},
  agent_enabled: false, operator_phone: null, created_at: '2026-01-01T00:00:00Z',
};

serviceMock.mockImplementation(() => ({
  from: (table: string) => table === 'onboarding_sessions'
    ? query(session)
    : table === 'contacts'
      ? query({ monthly_retainer: null })
      : table === 'client_capabilities'
        ? query([])
        : query([]),
}));

async function renderPage(access: 'member' | 'demo' | 'internal') {
  accessMock.mockResolvedValue(access);
  dashboardProps.value = null;
  const element = await DashPage({ params: Promise.resolve({ sessionId: 'fake-session' }) }) as unknown as {
    props: Record<string, unknown>;
  };
  return element.props;
}

describe('dash page partner payload gate', () => {
  it.each(['member', 'demo'] as const)('strips partner row fields for %s access', async access => {
    const props = await renderPage(access);
    const returns = props.returns as { partner: unknown; rows: Array<Record<string, unknown>> };
    expect(returns.partner).toBeNull();
    expect(returns.rows[0]).not.toHaveProperty('owner');
    expect(returns.rows[0]).not.toHaveProperty('partner_collected_in_window_cents');
  });

  it('keeps the partner payload for internal access', async () => {
    const props = await renderPage('internal');
    const returns = props.returns as { partner: { shareCents: number }; rows: Array<Record<string, unknown>> };
    expect(returns.partner.shareCents).toBe(7500);
    expect(returns.rows[0]).toMatchObject({ owner: 'partner', partner_collected_in_window_cents: 50000 });
  });
});
