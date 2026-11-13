// The login page follows ?next= only to a same-site path (safeNextPath).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}));

import LoginPage from './page';

async function signInWith(search: string) {
  window.history.replaceState(null, '', `/login${search}`);
  render(<LoginPage />);
  fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: 'member@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'pw-for-test' } });
  fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  return replace.mock.calls[0][0];
}

describe('LoginPage ?next=', () => {
  beforeEach(() => replace.mockReset());
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('follows a same-site path with its query', async () => {
    expect(await signInWith(`?next=${encodeURIComponent('/dash/abc?qb=connected')}`)).toBe('/dash/abc?qb=connected');
  });

  it('goes to /postlogin with no next', async () => {
    expect(await signInWith('')).toBe('/postlogin');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/x'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a tab trick', '/\t/evil.example'],
    ['an encoded protocol-relative URL', '/%2F%2Fevil.example'],
    ['an encoded backslash', '/%5Cevil.example'],
    ['a double-encoded protocol-relative URL', '/%252F%252Fevil.example'],
    ['a nested next', '/login?next=https://evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('refuses %s and goes to /postlogin', async (_, value) => {
    expect(await signInWith(`?next=${encodeURIComponent(value)}`)).toBe('/postlogin');
  });
});
