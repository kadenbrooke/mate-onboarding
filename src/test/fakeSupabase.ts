// Minimal in-memory Supabase stand-in for route tests that need the REAL access
// gates to run (lead-gate -> api-gate -> dash-access). Supports the query shapes
// those gates and the lead routes use: select/eq/maybeSingle/single, and
// update/insert/delete chains that resolve when awaited. Every write and every
// select is recorded (with its columns and eq filters) so tests can assert that
// nothing was written, or read, on a denied request, and that the gate looked up
// the right user and session.
//
// Never point this at real data: rows are whatever the test seeds.

type Row = Record<string, unknown>;
export type FakeWrite = { table: string; op: 'update' | 'insert' | 'delete'; values?: unknown; filters: [string, unknown][] };
export type FakeRead = { table: string; columns: string; filters: [string, unknown][] };

export type FakeDb = {
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  reads: FakeRead[];
  client: { from: (table: string) => unknown };
};

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = { tables, writes: [], reads: [], client: { from: (t: string) => builder(t) } };

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | FakeWrite['op'] = 'select';
    let values: unknown;
    let columns = '*';
    const likes: [string, string][] = [];
    const ins: [string, unknown[]][] = [];
    const notNull: string[] = [];
    const rows = () => (db.tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v)
      && ins.every(([k, vs]) => vs.includes(r[k]))
      && notNull.every(k => r[k] !== null && r[k] !== undefined)
      && likes.every(([k, pattern]) => {
      const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern;
      const value = r[k];
      return typeof value === 'string' && (pattern.endsWith('%') ? value.startsWith(prefix) : value === pattern);
    }));
    const logRead = () => { db.reads.push({ table, columns, filters: [...filters, ...ins.map(([k, vs]): [string, unknown] => [`in:${k}`, vs])] }); };
    const settle = () => {
      if (op === 'select') { logRead(); return { data: rows(), error: null }; }
      db.writes.push({ table, op, values, filters: [...filters] });
      return { data: null, error: null, count: op === 'delete' ? rows().length : null };
    };
    const b = {
      select: (cols?: string) => { columns = cols ?? '*'; return b; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      like: (k: string, pattern: string) => { likes.push([k, pattern]); return b; },
      in: (k: string, vs: unknown[]) => { ins.push([k, vs]); return b; },
      not: (k: string, op: string, v: unknown) => {
        if (op !== 'is' || v !== null) throw new Error(`fake not(${op}) unsupported`);
        notNull.push(k);
        return b;
      },
      order: () => b,
      limit: () => b,
      range: () => b,
      update: (v: unknown) => { op = 'update'; values = v; return b; },
      insert: (v: unknown) => { op = 'insert'; values = v; return b; },
      delete: () => { op = 'delete'; return b; },
      maybeSingle: () => {
        if (op !== 'select') return Promise.resolve({ ...settle(), data: values });
        logRead();
        return Promise.resolve({ data: rows()[0] ?? null, error: null });
      },
      single: () => {
        if (op !== 'select') return Promise.resolve({ ...settle(), data: values });
        logRead();
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
export const PRACTICE = 'cccccccc-0000-4000-8000-000000000003';

export const USERS = {
  memberA: { id: 'user-a', email: 'a@client-a.test' },
  memberB: { id: 'user-b', email: 'b@client-b.test' },
  practice: { id: 'user-practice', email: 'practice@jc.test' },
  internal: { id: 'user-int', email: 'ops@mate.test' },
} as const;

export function seedTenants(): Record<string, Row[]> {
  return {
    onboarding_sessions: [
      { id: TENANT_A, is_demo: false },
      { id: TENANT_B, is_demo: false },
      { id: DEMO, is_demo: true },
      { id: PRACTICE, is_demo: false, is_practice: true },
    ],
    client_leads: [
      { id: 'lead-a', session_id: TENANT_A, phone: '+18015550001' },
      { id: 'lead-b', session_id: TENANT_B, phone: '+18015550002' },
      { id: 'lead-demo', session_id: DEMO, phone: '+18015550003' },
      { id: 'lead-practice', session_id: PRACTICE, phone: '+18015550004' },
    ],
    portal_members: [
      { user_id: USERS.memberA.id, session_id: TENANT_A, role: 'owner' },
      { user_id: USERS.memberB.id, session_id: TENANT_B, role: 'owner' },
      { user_id: USERS.practice.id, session_id: PRACTICE, role: 'owner' },
    ],
    portal_access: [{ email: USERS.internal.email, client_slug: 'mate' }],
  };
}
