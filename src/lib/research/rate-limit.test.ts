// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allowAnonymousResearch, clientIp, ipKey, RESEARCH_ANON_PER_IP_PER_DAY, RESEARCH_SCOPE } from './rate-limit';

const req = (headers: Record<string, string>) => new Request('http://x/api/research', { headers });

describe('clientIp', () => {
  it('prefers the proxy-set X-Real-IP', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.7');
  });
  it('else takes the RIGHTMOST X-Forwarded-For hop, which a client cannot forge', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });
  it("falls back to one shared 'unknown' bucket", () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('allowAnonymousResearch', () => {
  it('counts the hashed IP against the daily cap, never the raw address', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await allowAnonymousResearch({ rpc } as unknown as SupabaseClient, req({ 'x-real-ip': '203.0.113.7' }))).toBe(true);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpc.mock.calls[0][0]).toBe('demo_counter_bump');
    expect(args).toEqual({ p_scope: RESEARCH_SCOPE, p_key: ipKey('203.0.113.7'), p_cap: RESEARCH_ANON_PER_IP_PER_DAY });
    expect(String(args.p_key)).not.toContain('203.0.113.7');
  });
  it('refuses once the cap is reached, and when the counter errors (fails closed)', async () => {
    const full = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } as unknown as SupabaseClient;
    const broken = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } }) } as unknown as SupabaseClient;
    expect(await allowAnonymousResearch(full, req({}))).toBe(false);
    expect(await allowAnonymousResearch(broken, req({}))).toBe(false);
  });
});
