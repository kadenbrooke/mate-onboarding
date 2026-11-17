// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => {
  const shape = { lookup: (...a: unknown[]) => lookupMock(...a) };
  return { ...shape, default: shape };
});

import { safeFetch } from './safe-fetch';

let fetchMock: ReturnType<typeof vi.fn>;
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('safeFetch', () => {
  it.each([
    ['loopback', 'http://127.0.0.1:8080/admin'],
    ['localhost', 'http://localhost:3000/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['RFC1918', 'http://10.0.0.5/'],
    ['docker bridge', 'http://172.17.0.1:5678/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['decimal loopback', 'http://2130706433/'],
    ['non-http scheme', 'file:///etc/passwd'],
  ])('refuses %s without connecting', async (_label, url) => {
    const r = await safeFetch(url);
    expect(r).toMatchObject({ res: null, blocked: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a public name that resolves to an internal address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }]);
    const r = await safeFetch('https://rebind.example/');
    expect(r).toMatchObject({ res: null, blocked: true, reason: 'host resolves to private IP: 10.1.2.3' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public site and never lets fetch follow redirects itself', async () => {
    const r = await safeFetch('https://public.example/');
    expect(r.res?.status).toBe(200);
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });

  it('follows a redirect to another public page after re-checking it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.public.example/home' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await safeFetch('https://public.example/');
    expect(r.res?.status).toBe(200);
    expect(r.finalUrl).toBe('https://www.public.example/home');
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect into the internal network', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    const r = await safeFetch('https://public.example/');
    expect(r).toMatchObject({ res: null, blocked: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after maxRedirects hops', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    const r = await safeFetch('https://public.example/', {}, { maxRedirects: 2 });
    expect(r).toMatchObject({ res: null, blocked: true, reason: 'too many redirects' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
