// Write gate for a dedicated data-project deployment (./tenancy).
//
// A dedicated deployment (today: J&C's) can be deployed and checked during
// prep, long before the final data copy into its project and before the old
// project stops taking that client's writes. Anything it wrote in that window
// would be overwritten or missed by the final copy. So it starts READ-ONLY:
//
//   JC_DASHBOARD_WRITES_ENABLED=1  -> writes allowed
//   unset, or any other value       -> every write to the data project is
//                                      refused server-side; reads still work
//
// Flipped to 1 only after the final copy is verified and the old project's
// writes for that client are blocked (docs/deploy/jc-dedicated-deployment.md).
// The shared deployment never reads the variable: its writes are unaffected.
//
// Enforced twice:
//   * route level: every route or webhook that writes calls
//     refuseIfWritesDisabled() (or holds, for cal.com) before any read, send or
//     write, so a refused request has no side effects at all and a clear error;
//   * client level: createServiceClient() hands out a read-only client while
//     the gate is shut (readOnlyDataClient), so a write path that forgot the
//     route check still cannot reach the data project.

import { NextResponse } from 'next/server';
import { readTenancy, type Env } from './tenancy';

export const WRITES_ENV = 'JC_DASHBOARD_WRITES_ENABLED';
export const WRITES_DISABLED_ERROR = 'Dashboard writes are not enabled on this deployment yet.';

/**
 * May this deployment write to its data project? Shared deployment: always.
 * Dedicated: only with JC_DASHBOARD_WRITES_ENABLED exactly "1". A config that
 * does not parse is treated as dedicated and shut (fail closed).
 */
export function dataWritesEnabled(env: Env = process.env): boolean {
  let mode: 'shared' | 'dedicated';
  try {
    mode = readTenancy(env).mode;
  } catch {
    return false;
  }
  return mode === 'shared' || env[WRITES_ENV] === '1';
}

/** 503 with a clear error while writes are shut; null when the route may go on. */
export function refuseIfWritesDisabled(): NextResponse | null {
  if (dataWritesEnabled()) return null;
  return NextResponse.json({ error: WRITES_DISABLED_ERROR, writes: 'disabled' }, { status: 503 });
}

export class DataWritesDisabledError extends Error {
  constructor(what: string) {
    super(`${WRITES_DISABLED_ERROR} (refused: ${what})`);
    this.name = 'DataWritesDisabledError';
  }
}

const TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_WRITES = new Set([
  'upload', 'update', 'remove', 'move', 'copy', 'uploadToSignedUrl', 'createSignedUploadUrl', 'emptyBucket',
]);

/** Pass reads through; turn every listed method into a refusal. */
function refuseMethods<T extends object>(target: T, writes: ReadonlySet<string>, label: string): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && writes.has(prop)) {
        return () => {
          throw new DataWritesDisabledError(`${label}.${prop}`);
        };
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });
}

type DataClientLike = {
  from: (relation: string) => object;
  rpc: (...args: never[]) => unknown;
  schema?: (schema: string) => unknown;
  storage?: { from: (bucket: string) => object };
};

/**
 * A data client that can read but never write: table insert/update/upsert/
 * delete, every RPC (an RPC may write; none on a dedicated deployment's path
 * is read-only today) and storage writes throw DataWritesDisabledError.
 */
export function readOnlyDataClient<T extends object>(client: T): T {
  const c = client as unknown as DataClientLike;
  return new Proxy(client, {
    get(obj, prop, receiver) {
      if (prop === 'from') {
        return (relation: string) => refuseMethods(c.from(relation), TABLE_WRITES, relation);
      }
      if (prop === 'rpc') {
        return (fn: string) => {
          throw new DataWritesDisabledError(`rpc ${fn}`);
        };
      }
      if (prop === 'schema' && c.schema) {
        return (schema: string) => readOnlyDataClient(c.schema!(schema) as object);
      }
      if (prop === 'storage' && c.storage) {
        const storage = c.storage;
        return new Proxy(storage, {
          get(s, p, r) {
            if (p === 'from') {
              return (bucket: string) => refuseMethods(storage.from(bucket), STORAGE_WRITES, `storage ${bucket}`);
            }
            if (typeof p === 'string' && /^(create|update|delete|empty)Bucket$/.test(p)) {
              return () => {
                throw new DataWritesDisabledError(`storage.${p}`);
              };
            }
            const value = Reflect.get(s, p, r);
            return typeof value === 'function' ? value.bind(s) : value;
          },
        });
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });
}
