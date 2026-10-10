import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { practiceStatus, requestTokenExchange } = vi.hoisted(() => ({
  practiceStatus: vi.fn(),
  requestTokenExchange: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: () => ({}) };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/dash-gate', () => ({ requireDashAccess: vi.fn(async () => 'member') }));
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));
vi.mock('@/lib/qbo/config', () => ({ qboEnvironment: () => 'sandbox' }));
vi.mock('@/lib/qbo/state', () => ({
  verifyState: () => ({ sessionId: 'practice-session', nonce: 'nonce' }),
  qbStateSecret: () => 'fake-secret',
  QB_STATE_COOKIE: 'qb_oauth_nonce',
}));
vi.mock('@/lib/qbo/rail', () => ({ requestTokenExchange }));

import { GET } from './route';

function request() {
  return new NextRequest(
    'http://mate.test/api/qb/callback?code=fake-code&state=fake-state&realmId=fake-realm',
    { headers: { cookie: 'qb_oauth_nonce=nonce' } },
  );
}

beforeEach(() => {
  practiceStatus.mockReset();
  requestTokenExchange.mockReset();
  requestTokenExchange.mockResolvedValue({ ok: true, realmId: 'fake-realm' });
});

describe('GET /api/qb/callback', () => {
  it('refuses the QBO token exchange for a practice tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: true });
    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dash/practice-session?qb=practice');
    expect(requestTokenExchange).not.toHaveBeenCalled();
  });

  it('exchanges the QBO token for a normal tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dash/practice-session?qb=connected');
    expect(requestTokenExchange).toHaveBeenCalledWith({
      sessionId: 'practice-session',
      realmId: 'fake-realm',
      code: 'fake-code',
      environment: 'sandbox',
    });
  });
});
