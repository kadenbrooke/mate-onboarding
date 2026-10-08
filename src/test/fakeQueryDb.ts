// Stateful in-memory stand-in for the read side of a Supabase client, for
// lib/command/fetch.ts. Unlike a canned stub it APPLIES every predicate
// (eq / in / gte / lt / is), ordering, limit and range to seeded rows, and
// projects the selected columns, so a query that drops its tenant filter
// really does return another tenant's rows and the test fails. Every read is
// recorded with its exact table, columns and predicates.
//
// SQL semantics where they matter: a comparison against null is false, so
// gte/gt/lt/neq never match a null column. Like Supabase's PostgREST, a
// response never carries more than `maxRows` rows (default 1000) whatever the
// range asks for, so a reader that does not page really does lose rows.
// Never point this at real data.

type Row = Record<string, unknown>;
type Err = { message: string; code?: string };

export type FakeRead = {
  table: string;
  columns: string;
  /** e.g. ['eq session_id s-1', 'in lead_id a,b', 'gte score 0'] in call order. */
  where: string[];
  order: string[];
  limit: number | null;
  range: [number, number] | null;
};

export type FakeQueryDb = {
  tables: Record<string, Row[]>;
  reads: FakeRead[];
  /** Make every read of a table fail with this error. */
  failTable(table: string, err: Err): void;
  /** Fail any read the predicate picks (e.g. one that filters a column the schema lacks). */
  failIf(pick: (read: FakeRead) => Err | null): void;
  client: { from(table: string): { select(cols: string): unknown } };
};

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

export function createFakeQueryDb(tables: Record<string, Row[]> = {}, opts: { maxRows?: number } = {}): FakeQueryDb {
  const maxRows = opts.maxRows ?? 1000;
  const failures = new Map<string, Err>();
  const pickers: ((read: FakeRead) => Err | null)[] = [];
  const db: FakeQueryDb = {
    tables,
    reads: [],
    failTable: (t, e) => { failures.set(t, e); },
    failIf: pick => { pickers.push(pick); },
    client: {
      from: (table: string) => ({
        select: (columns: string) => {
          const read: FakeRead = { table, columns, where: [], order: [], limit: null, range: null };
          const preds: ((r: Row) => boolean)[] = [];
          const orders: { col: string; asc: boolean }[] = [];
          const settle = () => {
            db.reads.push(read);
            const err = failures.get(table) ?? pickers.map(p => p(read)).find(Boolean);
            if (err) return { data: null, error: err };
            let rows = (db.tables[table] ?? []).filter(r => preds.every(p => p(r)));
            rows = [...rows].sort((a, b) => {
              for (const o of orders) {
                const av = a[o.col]; const bv = b[o.col];
                if (av == null && bv == null) continue;
                // Postgres default: nulls last ascending, first descending.
                if (av == null) return o.asc ? 1 : -1;
                if (bv == null) return o.asc ? -1 : 1;
                const c = cmp(av, bv);
                if (c !== 0) return o.asc ? c : -c;
              }
              return 0;
            });
            if (read.range) rows = rows.slice(read.range[0], read.range[1] + 1);
            if (read.limit != null) rows = rows.slice(0, read.limit);
            rows = rows.slice(0, maxRows);
            const cols = columns.trim() === '*' ? null : columns.split(',').map(c => c.trim());
            const data = rows.map(r => (cols ? Object.fromEntries(cols.map(c => [c, r[c] ?? null])) : { ...r }));
            return { data, error: null };
          };
          const b = {
            eq: (c: string, v: unknown) => { read.where.push(`eq ${c} ${v}`); preds.push(r => r[c] === v); return b; },
            in: (c: string, vs: unknown[]) => { read.where.push(`in ${c} ${vs.join(',')}`); preds.push(r => vs.includes(r[c])); return b; },
            neq: (c: string, v: unknown) => { read.where.push(`neq ${c} ${v}`); preds.push(r => r[c] != null && r[c] !== v); return b; },
            gt: (c: string, v: unknown) => { read.where.push(`gt ${c} ${v}`); preds.push(r => r[c] != null && cmp(r[c], v) > 0); return b; },
            gte: (c: string, v: unknown) => { read.where.push(`gte ${c} ${v}`); preds.push(r => r[c] != null && cmp(r[c], v) >= 0); return b; },
            lt: (c: string, v: unknown) => { read.where.push(`lt ${c} ${v}`); preds.push(r => r[c] != null && cmp(r[c], v) < 0); return b; },
            is: (c: string, v: null) => { read.where.push(`is ${c} ${v}`); preds.push(r => r[c] == null); return b; },
            order: (c: string, o: { ascending: boolean }) => {
              read.order.push(`${c} ${o.ascending ? 'asc' : 'desc'}`); orders.push({ col: c, asc: o.ascending }); return b;
            },
            limit: (n: number) => { read.limit = n; return b; },
            range: (f: number, t: number) => { read.range = [f, t]; return b; },
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
          };
          return b;
        },
      }),
    },
  };
  return db;
}
