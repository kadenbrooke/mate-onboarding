// Static guards for the control/data project split (./tenancy). The runtime
// tests prove today's code; these stop tomorrow's code from quietly routing a
// login or CRM read through the data client, or opening a third door to
// Supabase that skips the tenancy check.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { tenantRoute } from './tenant-proxy';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
const files = sourceFiles().map((p) => ({ file: rel(p), text: fs.readFileSync(p, 'utf8') }));

// Tables that live with the logins / our CRM in the control project.
const CONTROL_TABLES = /\.from\(\s*['"](portal_members|portal_access|portal_codes|portal_waitlist|contacts|contact_materials|nudges|interactions|build_requests|demo_sessions)['"]/;

// Onboarding / demo / internal surfaces that still use one client for both
// kinds of table. Safe only because a dedicated deployment never routes to
// them: the test below proves each path 404s there.
const SHARED_ONLY: Record<string, string> = {
  'app/api/mate/route.ts': '/api/mate',
  'app/api/mate/complete/route.ts': '/api/mate/complete',
  'app/api/portal/route.ts': '/api/portal',
  'app/api/demo/start/route.ts': '/api/demo/start',
  'app/handoff/[sessionId]/page.tsx': '/handoff/11111111-1111-4111-8111-111111111111',
  'lib/mate/portal-tools.ts': '/api/mate',
};

describe('control/data split, statically', () => {
  it('every file that touches a control-project table uses the control client, the user client, or is shared-only', () => {
    const offenders = files
      .filter(({ text }) => CONTROL_TABLES.test(text))
      .filter(({ file, text }) => {
        if (SHARED_ONLY[file]) return false;
        if (text.includes('createControlServiceClient')) return false;
        // Session-scoped user client only (RLS as the signed-in user, control project).
        if (!text.includes('createServiceClient') && text.includes('@/lib/supabase/server')) return false;
        return true;
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('only lib/supabase opens a Supabase client', () => {
    const openers = files
      .filter(({ text }) => /import\s+\{[^}]*\bcreateClient\b[^}]*\}\s+from\s+['"]@supabase\/supabase-js['"]/.test(text))
      .map(({ file }) => file);
    expect(openers).toEqual(['lib/supabase/service.ts']);
  });

  it('only lib/supabase/tenancy reads the data-project and moved-session config', () => {
    const readers = files
      .filter(({ text }) => /(process\.env\.|['"`])(SUPABASE_DATA_URL|SUPABASE_DATA_SECRET_KEY|MATE_DATA_SESSION_IDS|MATE_MOVED_SESSIONS)\b/.test(text))
      .map(({ file }) => file);
    expect(readers).toEqual(['lib/supabase/tenancy.ts']);
  });

  it('no source file hardcodes a Supabase project host', () => {
    const hosts = files.filter(({ text }) => /[a-z0-9]{20}\.supabase\.co/.test(text)).map(({ file }) => file);
    expect(hosts).toEqual([]);
  });
});

describe('shared-only surfaces are unreachable on a dedicated deployment', () => {
  const VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://control-project.supabase.co';
    process.env.SUPABASE_DATA_URL = 'https://client-data-project.supabase.co';
    process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
    process.env.MATE_DATA_SESSION_IDS = '11111111-1111-4111-8111-111111111111';
  });
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it.each(Object.entries(SHARED_ONLY))('%s (%s) answers 404', (file, route) => {
    expect(files.some((f) => f.file === file), `${file} exists`).toBe(true);
    const res = tenantRoute(new NextRequest(new URL(route, 'https://deploy.example.com'), { method: 'POST' }));
    expect(res?.status).toBe(404);
  });
});
