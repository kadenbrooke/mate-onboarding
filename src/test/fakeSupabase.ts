// Minimal in-memory Supabase stand-in for route tests that need the REAL access
// gates to run (lead-gate -> api-gate -> dash-access). Supports the query shapes
// those gates and the lead routes use: select/eq/maybeSingle/single, and
// update/insert/delete chains that resolve when awaited. Every write is recorded
// so tests can assert that nothing was written on a denied request.
//
// Never point this at real data: rows are whatever the test seeds.

type Row = Record<string, unknown>;
export type FakeWrite = { table: string; op: 'update' | 'insert' | 'delete'; values?: unknown; filters: [string, unknown][] };

export type FakeDb = {
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  client: { from: (table: string) => unknown };
};

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = { tables, writes: [], client: { from: (t: string) => builder(t) } };

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | FakeWrite['op'] = 'select';
    let values: unknown;
    const rows = () => (db.tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v));
    const settle = () => {
      if (op === 'select') return { data: rows(), error: null };
      db.writes.push({ table, op, values, filters: [...filters] });
      return { data: null, error: null, count: op === 'delete' ? rows().length : null };
    };
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      update: (v: unknown) => { op = 'update'; values = v; return b; },
      insert: (v: unknown) => { op = 'insert'; values = v; return b; },
      delete: () => { op = 'delete'; return b; },
      maybeSingle: () => Promise.resolve(op === 'select'
        ? { data: rows()[0] ?? null, error: null }
        : { ...settle(), data: values }),
      single: () => {
        if (op !== 'select') return Promise.resolve({ ...settle(), data: values });
        const r = rows();
        return Promise.resolve(r.length === 1
          ? { data: r[0], error: null }
          : { data: null, error: { message: 'not single' } });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(res, rej),
    };
    return b;
  }

  return db;
}

// Shared fixture: two real tenants, one demo, three users.
export const TENANT_A = '61400e73-0570-4167-88d9-d3a69650b15b'; // mapped in intakeTenants
export const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'; // real, not in intakeTenants
export const DEMO = 'b7573135-d4ec-43bb-bf33-a1d365739784';

export const USERS = {
  memberA: { id: 'user-a', email: 'a@client-a.test' },
  memberB: { id: 'user-b', email: 'b@client-b.test' },
  internal: { id: 'user-int', email: 'ops@mate.test' },
} as const;

export function seedTenants(): Record<string, Row[]> {
  return {
    onboarding_sessions: [
      { id: TENANT_A, is_demo: false },
      { id: TENANT_B, is_demo: false },
      { id: DEMO, is_demo: true },
    ],
    client_leads: [
      { id: 'lead-a', session_id: TENANT_A, phone: '+18015550001' },
      { id: 'lead-b', session_id: TENANT_B, phone: '+18015550002' },
      { id: 'lead-demo', session_id: DEMO, phone: '+18015550003' },
    ],
    portal_members: [
      { user_id: USERS.memberA.id, session_id: TENANT_A, role: 'owner' },
      { user_id: USERS.memberB.id, session_id: TENANT_B, role: 'owner' },
    ],
    portal_access: [{ email: USERS.internal.email, client_slug: 'mate' }],
  };
}
