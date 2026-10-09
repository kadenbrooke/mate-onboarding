import { describe, expect, it, vi } from 'vitest';

const { accessMock, serviceMock, notFoundMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  serviceMock: vi.fn(),
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

function query(data: unknown = []) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/portal/dash-gate', () => ({ requireDashAccess: accessMock }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: serviceMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('@/lib/command/fetch', () => ({
  fetchOpenBook: vi.fn(async () => ({ leads: [], signals: new Map(), complete: true })),
  fetchWonLeads: vi.fn(async () => ({ leads: [], complete: true })),
  fetchLastOutbound: vi.fn(async () => new Map()),
  fetchPaidByLead: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/metrics/revenue', () => ({
  fetchMetaSpend30dCents: vi.fn(async () => null),
  fetchRevenueBySource: vi.fn(async () => []),
  summarizeReturn: vi.fn(() => null),
}));
vi.mock('@/lib/command/commandCenter', () => ({
  buildCommandModel: vi.fn(() => ({ cards: [] })),
  outboundCandidates: vi.fn(() => ({ ids: [], since: null })),
}));
vi.mock('@/components/dash/command/CommandCenter', () => ({ CommandCenter: () => null }));
vi.mock('@/components/dash/MobileNav', () => ({ MobileNav: () => null }));

import CommandPage from './page';

serviceMock.mockImplementation(() => ({ from: () => query({ id: 'fake-session' }) }));

const params = { params: Promise.resolve({ sessionId: 'fake-session' }) };

describe('Command Center page gate', () => {
  it.each(['member', 'demo'] as const)('404s for %s access', async access => {
    accessMock.mockResolvedValue(access);
    await expect(CommandPage(params)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('renders for internal access', async () => {
    accessMock.mockResolvedValue('internal');
    await expect(CommandPage(params)).resolves.toBeTruthy();
  });
});
