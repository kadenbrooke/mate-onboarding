// Route manifest for dedicated deployments. The proxy (./tenant-proxy) lets a
// few broad prefixes through (/api/leads/, /api/assistant/chats/, the served
// session's /dash and /api/dash). Each route it lets through must enforce
// tenancy itself. This test walks every page and API route in the app, asks the
// real proxy whether a dedicated deployment would reach it, and requires every
// reachable route to be listed here with the guard it calls. A new route under
// a broad prefix fails until someone decides how it is guarded.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { tenantRoute } from './tenant-proxy';

const SRC = path.resolve(__dirname, '../..');
const APP = path.join(SRC, 'app');
const OWN = '11111111-1111-4111-8111-111111111111';

// route file (relative to src/app) -> a guard it must call, as `name(`.
const MANIFEST: Record<string, string> = {
  // served session's dashboard pages (each page, not just the layout)
  'dash/[sessionId]/layout.tsx': 'routeSession',
  'dash/[sessionId]/page.tsx': 'requireDashAccess',
  'dash/[sessionId]/assistant/page.tsx': 'requireDashAccess',
  'dash/[sessionId]/pipeline/page.tsx': 'requireDashAccess',
  'dash/[sessionId]/command/page.tsx': 'requireDashAccess',
  'dash/[sessionId]/leads/new/page.tsx': 'requireDashAccess',
  // login flow: reads only the control project, routes to served sessions only
  'login/page.tsx': 'createClient',
  'postlogin/page.tsx': 'readTenancy',
  'auth/callback/route.ts': 'exchangeCodeForSession',
  'auth/signout/route.ts': 'signOut',
  // dashboard APIs
  'api/dash/[sessionId]/events/route.ts': 'checkDashAccess',
  'api/dash/[sessionId]/leads/manual/route.ts': 'checkDashApiAccess',
  'api/dash/[sessionId]/snapshot/route.ts': 'checkDashApiAccess',
  'api/dash/[sessionId]/snapshot/[id]/route.ts': 'checkDashApiAccess',
  'api/dash/[sessionId]/snapshot/[id]/confirm/route.ts': 'checkDashApiAccess',
  'api/leads/[id]/route.ts': 'checkDashApiAccess',
  'api/leads/[id]/handler/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/do-not-contact/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/status/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/reply/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/outcome/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/payments/route.ts': 'checkLeadApiAccess',
  'api/leads/[id]/payments/[paymentId]/route.ts': 'checkLeadApiAccess',
  'api/assistant/chat/route.ts': 'assertAssistantAccess',
  'api/assistant/chats/route.ts': 'assertAssistantAccess',
  'api/assistant/chats/[chatId]/route.ts': 'assertAssistantAccess',
  'api/qb/connect/route.ts': 'requireDashAccess',
  'api/qb/callback/route.ts': 'requireDashAccess',
  'api/connect/google/route.ts': 'unservedSessionResponse',
  'api/connect/google/callback/route.ts': 'routeSession',
  'api/manifest/route.ts': 'routeSession',
  // machine callers (token / signature auth) carrying a session
  'api/leads/ingest/route.ts': 'unservedSessionResponse',
  'api/agent/postcall/route.ts': 'unservedSessionResponse',
  'api/agent/quote-scan/route.ts': 'unservedSessionResponse',
  'api/agent/signal/route.ts': 'unservedSessionResponse',
  'api/webhooks/calcom/route.ts': 'attributeBooking',
  // crons
  'api/ads/refresh/route.ts': 'routeSession',
  'api/calendar/sync/route.ts': 'syncAllCalendars',
};

function routeFiles(dir = APP): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /^(page|route|layout)\.tsx?$/.test(e.name) ? [path.relative(APP, p).split(path.sep).join('/')] : [];
  });
}

/** src/app file -> a concrete URL a request could use. */
function urlFor(file: string): string {
  const segs = file.split('/').slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s)) // route groups add no segment
    .map((s) => (s === '[sessionId]' ? OWN : s.replace(/^\[(.+)\]$/, 'sample-$1')));
  return `/${segs.join('/')}`;
}

const VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS', 'MATE_MOVED_SESSIONS'];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  delete process.env.MATE_MOVED_SESSIONS;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://control-project.supabase.co';
  process.env.SUPABASE_DATA_URL = 'https://client-data-project.supabase.co';
  process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
  process.env.MATE_DATA_SESSION_IDS = OWN;
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const reachable = (file: string) =>
  tenantRoute(new NextRequest(new URL(urlFor(file), 'https://deploy.example.com'), { method: 'POST' })) === null;

describe('dedicated deployment route manifest', () => {
  const files = routeFiles();

  it('finds the app routes', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain('api/leads/[id]/status/route.ts');
  });

  it('every route a dedicated deployment can reach is listed with its guard', () => {
    const unlisted = files.filter((f) => reachable(f) && !(f in MANIFEST));
    expect(unlisted).toEqual([]);
  });

  it.each(Object.entries(MANIFEST))('%s calls %s', (file, guard) => {
    const full = path.join(APP, file);
    expect(fs.existsSync(full), `${file} exists`).toBe(true);
    expect(reachable(file), `${file} is reachable on a dedicated deployment`).toBe(true);
    expect(fs.readFileSync(full, 'utf8')).toMatch(new RegExp(`\\b${guard}\\(`));
  });

  it('the calendar cron helper constrains its scan by tenancy', () => {
    const lib = fs.readFileSync(path.join(SRC, 'lib/metrics/calendarSyncRun.ts'), 'utf8');
    expect(lib).toMatch(/\.in\('id', \[\.\.\.tenancy\.sessions\]\)/);
  });

  it('a made-up route under a broad prefix is reachable, which is why this manifest exists', () => {
    expect(reachable('api/leads/[id]/new-thing/route.ts')).toBe(true);
    expect(reachable('api/assistant/chats/[chatId]/export/route.ts')).toBe(true);
  });

  // Write gate (./write-gate). A reachable route either never writes, or calls
  // the gate and is exercised by src/test/writeGate.test.ts.
  const READ_ONLY = new Set([
    'dash/[sessionId]/layout.tsx',
    'dash/[sessionId]/page.tsx',
    'dash/[sessionId]/assistant/page.tsx',
    'dash/[sessionId]/pipeline/page.tsx',
    'dash/[sessionId]/command/page.tsx',
    'dash/[sessionId]/leads/new/page.tsx',
    'login/page.tsx',
    'postlogin/page.tsx',
    'auth/callback/route.ts',
    'auth/signout/route.ts',
    'api/dash/[sessionId]/events/route.ts',
    'api/manifest/route.ts',
  ]);
  const WRITE_OP = /\.(insert|update|upsert|delete|rpc|upload|remove)\(/;
  const WRITE_HELPERS = /\b(emitClientEvent|logMessage|setHandler|applyNoteToLead|applyQuoteOutcome|applyPostcallChoice|runQuoteMenuScan|syncSessionCalendar|syncAllCalendars|holdBooking|requestTokenExchange|recordSpokenOptOut)\b/;

  it('read-only routes never write, directly or through a write helper', () => {
    for (const file of READ_ONLY) {
      const text = fs.readFileSync(path.join(APP, file), 'utf8');
      expect(text, file).not.toMatch(WRITE_OP);
      expect(text, file).not.toMatch(WRITE_HELPERS);
    }
  });

  it('every other reachable route calls the write gate and is covered by the write-gate test', () => {
    const gateTest = fs.readFileSync(path.join(SRC, 'test/writeGate.test.ts'), 'utf8');
    const gated = Object.keys(MANIFEST).filter((f) => !READ_ONLY.has(f));
    expect(gated.length).toBeGreaterThan(20);
    for (const file of gated) {
      const text = fs.readFileSync(path.join(APP, file), 'utf8');
      expect(text, `${file} calls the gate`).toMatch(/\b(refuseIfWritesDisabled|dataWritesEnabled)\(/);
      expect(gateTest, `${file} is in writeGate.test.ts`).toContain(`route: '${file}'`);
    }
    for (const file of READ_ONLY) expect(MANIFEST[file], `${file} is in the manifest`).toBeDefined();
  });
});
