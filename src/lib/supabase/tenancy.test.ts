import { describe, expect, it } from 'vitest';
import { DEMO_SESSION_ID } from '@/lib/portal/demo';
import { readTenancy, routeSession, TenancyConfigError } from './tenancy';

// Synthetic ids and hosts only: no real tenant's project is named here.
const CONTROL = 'https://control-project.supabase.co';
const DATA = 'https://client-data-project.supabase.co';
const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const dedicatedEnv = (over: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: CONTROL,
  SUPABASE_DATA_URL: DATA,
  SUPABASE_DATA_SECRET_KEY: 'data-secret-placeholder',
  MATE_DATA_SESSION_IDS: OWN,
  ...over,
});

describe('readTenancy: shared (no data vars)', () => {
  it('is shared with nothing moved when every new var is unset', () => {
    const t = readTenancy({ NEXT_PUBLIC_SUPABASE_URL: CONTROL });
    expect(t).toEqual({ mode: 'shared', moved: new Map() });
    expect(routeSession(OWN, t)).toEqual({ served: true });
    expect(routeSession(DEMO_SESSION_ID, t)).toEqual({ served: true });
  });

  it('treats blank values as unset', () => {
    const t = readTenancy({ SUPABASE_DATA_URL: '  ', SUPABASE_DATA_SECRET_KEY: '', MATE_DATA_SESSION_IDS: '' });
    expect(t.mode).toBe('shared');
  });

  it('forwards moved sessions to a bare https origin, case-insensitively', () => {
    const t = readTenancy({ MATE_MOVED_SESSIONS: `${OWN.toUpperCase()}=https://client.example.com` });
    expect(routeSession(OWN, t)).toEqual({ served: false, movedTo: 'https://client.example.com' });
    expect(routeSession(OTHER, t)).toEqual({ served: true });
  });

  it.each([
    ['not a uuid', 'abc=https://client.example.com'],
    ['missing target', OWN],
    ['http target', `${OWN}=http://client.example.com`],
    ['target with a path', `${OWN}=https://client.example.com/dash`],
    ['the public demo', `${DEMO_SESSION_ID}=https://client.example.com`],
  ])('refuses a malformed MATE_MOVED_SESSIONS (%s)', (_label, value) => {
    expect(() => readTenancy({ MATE_MOVED_SESSIONS: value })).toThrow(TenancyConfigError);
  });
});

describe('readTenancy: dedicated', () => {
  it('locks the deployment to the listed sessions', () => {
    const t = readTenancy(dedicatedEnv());
    expect(t).toMatchObject({ mode: 'dedicated', dataUrl: DATA, sessions: [OWN] });
    expect(routeSession(OWN, t)).toEqual({ served: true });
    expect(routeSession(OTHER, t)).toEqual({ served: false, movedTo: null });
    expect(routeSession('demo', t)).toEqual({ served: false, movedTo: null });
    expect(routeSession(DEMO_SESSION_ID, t)).toEqual({ served: false, movedTo: null });
    expect(routeSession('', t)).toEqual({ served: false, movedTo: null });
  });

  it('never lets the public demo session be listed', () => {
    expect(() => readTenancy(dedicatedEnv({ MATE_DATA_SESSION_IDS: `${OWN},${DEMO_SESSION_ID}` })))
      .toThrow(/public demo/);
  });

  it.each(['SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS'])(
    'refuses a half-set config (%s missing)',
    (name) => {
      expect(() => readTenancy(dedicatedEnv({ [name]: undefined }))).toThrow(/half configured/);
    },
  );

  it('refuses a "dedicated" data project that is really the control project', () => {
    expect(() => readTenancy(dedicatedEnv({ SUPABASE_DATA_URL: `${CONTROL}/` }))).toThrow(/different project/);
  });

  it('refuses non-uuid session ids, an empty list, http data urls and moved sessions', () => {
    expect(() => readTenancy(dedicatedEnv({ MATE_DATA_SESSION_IDS: 'demo' }))).toThrow(TenancyConfigError);
    expect(() => readTenancy(dedicatedEnv({ MATE_DATA_SESSION_IDS: ' , ' }))).toThrow(TenancyConfigError);
    expect(() => readTenancy(dedicatedEnv({ SUPABASE_DATA_URL: 'http://client-data-project.supabase.co' })))
      .toThrow(/https/);
    expect(() => readTenancy(dedicatedEnv({ MATE_MOVED_SESSIONS: `${OTHER}=https://x.example.com` })))
      .toThrow(/shared deployment/);
    expect(() => readTenancy(dedicatedEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }))).toThrow(/logins/);
  });
});
