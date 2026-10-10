import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { practiceStatus, resolveEndpoints } = vi.hoisted(() => ({
  practiceStatus: vi.fn(),
  resolveEndpoints: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: () => ({}) };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/dash-gate', () => ({ requireDashAccess: vi.fn(async () => 'member') }));
vi.mock('@/lib/portal/demo', () => ({ resolveSessionId: (id: string) => id }));
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));
vi.mock('@/lib/qbo/config', () => ({
  qboOAuthConfig: () => ({ environment: 'sandbox', clientId: 'fake-client', redirectUri: 'https://mate.example.test/qb/callback' }),
}));
vi.mock('@/lib/qbo/discovery', () => ({ resolveEndpoints }));
vi.mock('@/lib/qbo/oauth', () => ({ buildAuthorizeUrl: () => 'https://intuit.example.test/authorize' }));
vi.mock('@/lib/qbo/state', () => ({
  signState: () => 'fake-state',
  newNonce: () => 'fake-nonce',
  qbStateSecret: () => 'fake-secret',
  QB_STATE_COOKIE: 'qb_oauth_nonce',
}));

import { GET } from './route';

beforeEach(() => {
  practiceStatus.mockReset();
  resolveEndpoints.mockReset();
  resolveEndpoints.mockResolvedValue({ authorization_endpoint: 'https://intuit.example.test/authorize' });
});

describe('GET /api/qb/connect', () => {
  it('refuses the QBO OAuth flow for a practice tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: true });
    const response = await GET(new NextRequest('http://mate.test/api/qb/connect?sessionId=practice-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dash/practice-session?qb=practice');
    expect(resolveEndpoints).not.toHaveBeenCalled();
  });

  it('starts the QBO OAuth flow for a normal tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    const response = await GET(new NextRequest('http://mate.test/api/qb/connect?sessionId=normal-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://intuit.example.test/authorize');
    expect(resolveEndpoints).toHaveBeenCalledWith('sandbox');
  });
});
