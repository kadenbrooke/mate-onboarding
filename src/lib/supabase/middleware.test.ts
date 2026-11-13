// @vitest-environment node
// The ?next= the auth gate writes is checked like the one the login page reads
// (src/lib/portal/safe-next.ts).
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { updateSession } from './middleware';

const next = async (url: string) => {
  const response = await updateSession(new NextRequest(url));
  expect(response.status).toBe(307);
  const location = new URL(response.headers.get('location')!);
  expect(location.pathname).toBe('/login');
  return location.searchParams.get('next');
};

describe('updateSession: signed-out redirect to /login', () => {
  it('carries a plain same-site path and its query as next', async () => {
    expect(await next('https://mate.test/codes?tab=new')).toBe('/codes?tab=new');
  });

  it.each([
    ['a protocol-relative path', 'https://mate.test//evil.example/x'],
    ['an encoded protocol-relative path', 'https://mate.test/%2F%2Fevil.example'],
    ['an encoded backslash', 'https://mate.test/%5Cevil.example'],
    ['a nested next in the query', 'https://mate.test/codes?next=https://evil.example'],
  ])('drops next for %s', async (_, url) => {
    expect(await next(url)).toBeNull();
  });
});
