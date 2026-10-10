import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DataWritesDisabledError, WRITES_DISABLED_ERROR, dataWritesEnabled, readOnlyDataClient, refuseIfWritesDisabled,
} from './write-gate';

// Synthetic hosts and ids only.
const OWN = '11111111-1111-4111-8111-111111111111';
const shared = { NEXT_PUBLIC_SUPABASE_URL: 'https://control-project.supabase.co' };
const dedicated = {
  ...shared,
  SUPABASE_DATA_URL: 'https://client-data-project.supabase.co',
  SUPABASE_DATA_SECRET_KEY: 'data-key-for-tests',
  MATE_DATA_SESSION_IDS: OWN,
};

describe('dataWritesEnabled', () => {
  it('the shared deployment always writes, whatever the variable says', () => {
    for (const v of [undefined, '', '0', '1', 'false']) {
      expect(dataWritesEnabled({ ...shared, JC_DASHBOARD_WRITES_ENABLED: v })).toBe(true);
    }
  });

  it('a dedicated deployment writes only with the variable exactly "1"', () => {
    expect(dataWritesEnabled({ ...dedicated, JC_DASHBOARD_WRITES_ENABLED: '1' })).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', '01', 'on']) {
      expect(dataWritesEnabled({ ...dedicated, JC_DASHBOARD_WRITES_ENABLED: v }), String(v)).toBe(false);
    }
  });

  it('a config that does not parse is shut (fail closed)', () => {
    expect(dataWritesEnabled({ ...dedicated, MATE_DATA_SESSION_IDS: undefined, JC_DASHBOARD_WRITES_ENABLED: '1' })).toBe(false);
    expect(dataWritesEnabled({ ...shared, MATE_MOVED_SESSIONS: 'garbage' })).toBe(false);
  });
});

describe('refuseIfWritesDisabled', () => {
  const KEYS = [...Object.keys(dedicated), 'JC_DASHBOARD_WRITES_ENABLED', 'MATE_MOVED_SESSIONS'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('answers 503 with a clear error while shut, null when open or shared', async () => {
    Object.assign(process.env, dedicated);
    const res = refuseIfWritesDisabled();
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: WRITES_DISABLED_ERROR, writes: 'disabled' });

    process.env.JC_DASHBOARD_WRITES_ENABLED = '1';
    expect(refuseIfWritesDisabled()).toBeNull();

    for (const k of Object.keys(dedicated)) delete process.env[k];
    Object.assign(process.env, shared);
    delete process.env.JC_DASHBOARD_WRITES_ENABLED;
    expect(refuseIfWritesDisabled()).toBeNull();
  });
});

describe('readOnlyDataClient', () => {
  function fakeClient() {
    const calls: string[] = [];
    const builder = (table: string) => ({
      select: (cols: string) => { calls.push(`${table}.select ${cols}`); return Promise.resolve({ data: [], error: null }); },
      insert: () => { calls.push(`${table}.insert`); return Promise.resolve({ error: null }); },
      update: () => { calls.push(`${table}.update`); return Promise.resolve({ error: null }); },
      upsert: () => { calls.push(`${table}.upsert`); return Promise.resolve({ error: null }); },
      delete: () => { calls.push(`${table}.delete`); return Promise.resolve({ error: null }); },
    });
    const bucket = (name: string) => ({
      download: () => { calls.push(`${name}.download`); return Promise.resolve({ data: null, error: null }); },
      createSignedUrl: () => { calls.push(`${name}.createSignedUrl`); return Promise.resolve({ data: null, error: null }); },
      upload: () => { calls.push(`${name}.upload`); return Promise.resolve({ error: null }); },
      remove: () => { calls.push(`${name}.remove`); return Promise.resolve({ error: null }); },
      move: () => { calls.push(`${name}.move`); return Promise.resolve({ error: null }); },
    });
    return {
      calls,
      client: {
        from: builder,
        rpc: vi.fn(() => { calls.push('rpc'); return Promise.resolve({ error: null }); }),
        schema: () => ({ from: builder, rpc: () => { calls.push('schema.rpc'); } }),
        storage: { from: bucket, createBucket: () => { calls.push('createBucket'); } },
      },
    };
  }

  it('lets reads through', async () => {
    const { client, calls } = fakeClient();
    const ro = readOnlyDataClient(client);
    await ro.from('client_leads').select('id');
    await ro.storage.from('lead-snapshots').download();
    await ro.storage.from('lead-snapshots').createSignedUrl();
    expect(calls).toEqual(['client_leads.select id', 'lead-snapshots.download', 'lead-snapshots.createSignedUrl']);
  });

  it('refuses every table write, every RPC and every storage write, before reaching the client', () => {
    const { client, calls } = fakeClient();
    const ro = readOnlyDataClient(client);
    const attempts: (() => unknown)[] = [
      () => ro.from('client_leads').insert(),
      () => ro.from('client_leads').update(),
      () => ro.from('ad_metrics').upsert(),
      () => ro.from('client_appointments').delete(),
      () => ro.rpc(),
      () => ro.schema().from('x').insert(),
      () => ro.schema().rpc(),
      () => ro.storage.from('lead-snapshots').upload(),
      () => ro.storage.from('lead-snapshots').remove(),
      () => ro.storage.from('lead-snapshots').move(),
      () => ro.storage.createBucket(),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(DataWritesDisabledError);
    expect(calls).toEqual([]);
  });
});
