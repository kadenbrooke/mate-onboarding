import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { DEMO_SESSION_ID } from '@/lib/portal/demo';

// The auth refresh is not under test: a sentinel says "the request went on".
const passed = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    passed.count += 1;
    return NextResponse.next();
  },
}));

import { proxy } from '@/proxy';

const CONTROL = 'https://control-project.supabase.co';
const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS', 'MATE_MOVED_SESSIONS'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = CONTROL;
  passed.count = 0;
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function dedicated() {
  process.env.SUPABASE_DATA_URL = 'https://client-data-project.supabase.co';
  process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
  process.env.MATE_DATA_SESSION_IDS = OWN;
}

const go = (path: string, method = 'GET') =>
  proxy(new NextRequest(new URL(path, 'https://deploy.example.com'), { method }));

// Every path the app serves, so "unchanged" is checked across the whole surface.
const ALL_PATHS = [
  '/', '/login', '/signup', '/claim', '/onboard', '/portal', '/demo', '/codes', '/postlogin',
  `/handoff/${OWN}`, `/dash/${OWN}`, `/dash/${OWN}/pipeline`, '/dash/demo', `/dash/${DEMO_SESSION_ID}`,
  `/dash/${OTHER}`, '/api/demo/start', '/api/sandbox', '/api/signup', '/api/waitlist', '/api/session',
  '/api/mate', '/api/mate/complete', '/api/portal', '/api/research', '/api/claim', '/api/leads/ingest',
  '/api/leads/lead-1/status', `/api/dash/${OWN}/events`, '/api/ads/refresh', '/api/calendar/sync',
];

describe('shared deployment', () => {
  it('with the new vars unset, every path goes straight on as before', async () => {
    for (const p of ALL_PATHS) {
      const res = await go(p);
      expect(res.status, p).toBe(200);
    }
    expect(passed.count).toBe(ALL_PATHS.length);
  });

  it('forwards a moved session\'s dashboard pages and dashboard APIs, keeping path and query', async () => {
    process.env.MATE_MOVED_SESSIONS = `${OWN}=https://client.example.com`;

    const page = await go(`/dash/${OWN}/pipeline?sort=score`);
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe(`https://client.example.com/dash/${OWN}/pipeline?sort=score`);

    const api = await go(`/api/dash/${OWN}/events?since=x`);
    expect(api.headers.get('location')).toBe(`https://client.example.com/api/dash/${OWN}/events?since=x`);

    // Other tenants and the demo stay where they are.
    for (const p of [`/dash/${OTHER}`, '/dash/demo', `/dash/${DEMO_SESSION_ID}`, '/login']) {
      expect((await go(p)).status, p).toBe(200);
    }
    expect(passed.count).toBe(4);
  });

  it('a malformed moved list answers 503 instead of guessing', async () => {
    process.env.MATE_MOVED_SESSIONS = 'nonsense';
    expect((await go(`/dash/${OWN}`)).status).toBe(503);
    expect(passed.count).toBe(0);
  });
});

describe('dedicated deployment', () => {
  beforeEach(dedicated);

  it('serves its own dashboard and the routes that dashboard, its crons and webhooks use', async () => {
    const allowed = [
      `/dash/${OWN}`, `/dash/${OWN}/pipeline`, `/dash/${OWN}/assistant`, `/api/dash/${OWN}/events`,
      '/login', '/postlogin', '/auth/callback', '/auth/signout', '/api/leads/ingest', '/api/leads/lead-1/outcome',
      '/api/assistant/chats', '/api/assistant/chats/chat-1', '/api/assistant/chat', '/api/ads/refresh',
      '/api/calendar/sync', '/api/manifest', '/api/connect/google', '/api/connect/google/callback',
      '/api/qb/connect', '/api/qb/callback', '/api/agent/postcall', '/api/agent/quote-scan',
      '/api/agent/signal', '/api/webhooks/calcom',
    ];
    for (const p of allowed) expect((await go(p)).status, p).toBe(200);
    expect(passed.count).toBe(allowed.length);
  });

  it('never serves the public demo, another tenant, or any onboarding/public surface', async () => {
    const denied = [
      '/dash/demo', `/dash/${DEMO_SESSION_ID}`, `/dash/${DEMO_SESSION_ID}/pipeline`, `/dash/${OTHER}`,
      `/api/dash/${OTHER}/events`, `/api/dash/${DEMO_SESSION_ID}/snapshot`, '/dash', '/demo', '/signup',
      '/claim', '/onboard', '/portal', '/codes', `/handoff/${OWN}`, '/api/demo/start', '/api/sandbox',
      '/api/signup', '/api/waitlist', '/api/session', '/api/mate', '/api/mate/complete', '/api/portal',
      '/api/research', '/api/claim', '/api/unknown',
    ];
    for (const p of denied) expect((await go(p, p.startsWith('/api/') ? 'POST' : 'GET')).status, p).toBe(404);
    expect(passed.count).toBe(0);
  });

  it('sends the bare root to the post-login router', async () => {
    const res = await go('/');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://deploy.example.com/postlogin');
  });

  it('a half-configured deployment answers 503 for everything', async () => {
    delete process.env.MATE_DATA_SESSION_IDS;
    for (const p of [`/dash/${OWN}`, '/login', '/api/leads/ingest']) expect((await go(p)).status, p).toBe(503);
    expect(passed.count).toBe(0);
  });
});
