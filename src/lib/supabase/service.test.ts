import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Which project each service client actually points at. createClient is the
// one door to Supabase, so recording its url/key proves where reads go.
const created = vi.hoisted(() => [] as { url: string; key: string }[]);
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string) => {
    created.push({ url, key });
    return { url };
  },
}));

import { createControlServiceClient, createServiceClient } from './service';

const CONTROL = 'https://control-project.supabase.co';
const DATA = 'https://client-data-project.supabase.co';
const OWN = '11111111-1111-4111-8111-111111111111';
const VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_DATA_URL',
  'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS', 'MATE_MOVED_SESSIONS',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = CONTROL;
  process.env.SUPABASE_SECRET_KEY = 'control-secret-placeholder';
  created.length = 0;
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('service clients', () => {
  it('with the new vars unset, the data client is exactly the old shared client', () => {
    createServiceClient();
    createControlServiceClient();
    expect(created).toEqual([
      { url: CONTROL, key: 'control-secret-placeholder' },
      { url: CONTROL, key: 'control-secret-placeholder' },
    ]);
  });

  it('keeps the old error when the shared project is not configured', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => createServiceClient()).toThrow(
      'Supabase service client missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY',
    );
  });

  it('a moved-sessions list on the shared deployment does not move its data client', () => {
    process.env.MATE_MOVED_SESSIONS = `${OWN}=https://client.example.com`;
    createServiceClient();
    expect(created).toEqual([{ url: CONTROL, key: 'control-secret-placeholder' }]);
  });

  it('a dedicated deployment reads data from its own project and logins from control', () => {
    process.env.SUPABASE_DATA_URL = DATA;
    process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
    process.env.MATE_DATA_SESSION_IDS = OWN;
    createServiceClient();
    createControlServiceClient();
    expect(created).toEqual([
      { url: DATA, key: 'data-secret-placeholder' },
      { url: CONTROL, key: 'control-secret-placeholder' },
    ]);
  });

  it('a half-configured dedicated deployment opens no client at all', () => {
    process.env.SUPABASE_DATA_URL = DATA;
    expect(() => createServiceClient()).toThrow(/half configured/);
    expect(created).toEqual([]);
  });
});
