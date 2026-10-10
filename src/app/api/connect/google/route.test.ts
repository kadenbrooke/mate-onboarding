import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { practiceStatus } = vi.hoisted(() => ({ practiceStatus: vi.fn() }));

vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: () => ({}) };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));

import { GET } from './route';

beforeEach(() => {
  practiceStatus.mockReset();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'fake-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://mate.example.test/google/callback';
});

describe('GET /api/connect/google', () => {
  it('refuses to start Google OAuth for a practice tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: true });
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=practice-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dash/practice-session?google=practice');
  });

  it('starts Google OAuth for a normal tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=normal-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');
  });
});
