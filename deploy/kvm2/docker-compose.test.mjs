// Offline tests: npm run test:deploy (node --test deploy/kvm2/*.test.mjs)
// Reads deploy/kvm2/docker-compose.yml and mate-crons.workflow.json as text/JSON (no docker, no n8n).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ALL_NAMES, SECRET_NAMES, SESSION_SECRET, appEnv } from './write-app-env.mjs';

const COMPOSE = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');
const WORKFLOW = JSON.parse(readFileSync(new URL('./mate-crons.workflow.json', import.meta.url), 'utf8'));
const VERCEL = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const HOST = 'mate.auto-mate.business';

/** Every `traefik.*` label, unquoted. */
function labels() {
  const out = {};
  for (const line of COMPOSE.split('\n')) {
    const m = line.match(/^\s+(traefik\.[^:\s]+):\s*(.+?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}
const L = labels();

test('serves only MATE_HOST (default mate.auto-mate.business) through Traefik on websecure with its own cert', () => {
  assert.equal(L['traefik.http.routers.mate.rule'], `Host(\`\${MATE_HOST:-${HOST}}\`)`);
  assert.equal(L['traefik.http.routers.mate.entrypoints'], 'websecure');
  assert.equal(L['traefik.http.routers.mate.tls.certresolver'], 'mytlschallenge');
  assert.equal(L['traefik.docker.network'], 'root_default');
  assert.equal(L['traefik.http.services.mate.loadbalancer.server.port'], '3000');
  // The redirect origin is built from the same host as the router, so they cannot drift apart.
  assert.match(COMPOSE, new RegExp(`\\n {8}NEXT_PUBLIC_MATE_URL: https://\\$\\{MATE_HOST:-${HOST.replace(/\./g, '\\.')}\\}\\n`));
  // Only one router: nothing else on KVM2 is claimed.
  assert.deepEqual(Object.keys(L).filter((k) => k.startsWith('traefik.http.routers.')).map((k) => k.split('.')[3]).filter((v, i, a) => a.indexOf(v) === i), ['mate']);
});

test('the browser Supabase values are build args from --env-file, required; no server secret is a build arg', () => {
  assert.match(COMPOSE, /NEXT_PUBLIC_SUPABASE_URL: \$\{NEXT_PUBLIC_SUPABASE_URL:\?/);
  assert.match(COMPOSE, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: \$\{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:\?/);
  const args = COMPOSE.match(/\n {6}args:\n((?: {8}.+\n)+)/)[1];
  assert.deepEqual(args.trim().split('\n').map((l) => l.trim().split(':')[0]), ['NEXT_PUBLIC_MATE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
});

test('hardened like the clock: read-only, tmpfs only for cache and /tmp, no caps, memory capped at 768m', () => {
  assert.match(COMPOSE, /\n {4}read_only: true\n/);
  assert.match(COMPOSE, /\n {4}mem_limit: 768m\n/);
  assert.match(COMPOSE, /\n {4}cpus: 1\.0\n/);
  assert.match(COMPOSE, /\n {4}cap_drop:\n {6}- ALL\n/);
  assert.match(COMPOSE, /no-new-privileges:true/);
  assert.match(COMPOSE, /\n {4}restart: unless-stopped\n/);
  assert.match(COMPOSE, /\n {6}NODE_ENV: production\b/);
  assert.match(COMPOSE, /- \$\{MATE_ENV_FILE:-\/opt\/mate\/app\.env\}/);
  const tmpfs = COMPOSE.match(/\n {4}tmpfs:\n((?: {6}- .+\n)+)/)[1].trim().split('\n').map((l) => l.trim().slice(2).split(':')[0]);
  assert.deepEqual(tmpfs, ['/app/.next/cache', '/tmp']);
  assert.match(COMPOSE, /\n {2}root_default:\n {4}external: true\n/);
});

test('the n8n workflow runs the same two crons as vercel.json, at the same UTC times, on the public host', () => {
  assert.equal(WORKFLOW.active, false);
  assert.equal(WORKFLOW.settings.timezone, 'UTC');
  const byName = Object.fromEntries(WORKFLOW.nodes.map((n) => [n.name, n]));
  const jobs = Object.entries(WORKFLOW.connections).map(([from, c]) => {
    const target = byName[c.main[0][0].node];
    return { path: new URL(target.parameters.url).pathname, schedule: byName[from].parameters.rule.interval[0].expression, target };
  });
  const sort = (a) => [...a].sort((x, y) => x.path.localeCompare(y.path));
  assert.deepEqual(sort(jobs).map(({ path, schedule }) => ({ path, schedule })), sort(VERCEL.crons));
  for (const { target } of jobs) {
    assert.equal(new URL(target.parameters.url).origin, `https://${HOST}`);
    assert.equal(target.parameters.method, 'GET'); // what Vercel Cron sends
    assert.equal(target.parameters.authentication, 'genericCredentialType');
    assert.equal(target.parameters.genericAuthType, 'httpHeaderAuth');
    assert.equal(target.credentials.httpHeaderAuth.name, 'Mate cron secret');
  }
});

test('the workflow file carries no secret: no header values, no Bearer token', () => {
  const text = JSON.stringify(WORKFLOW);
  assert.doesNotMatch(text, /Bearer|headerParameters|sendHeaders|x-ingest-token/i);
});

test('VERCEL is never set in the production container (it would re-enable request.url redirects)', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  // Not in the image: no ENV / ARG names it.
  assert.doesNotMatch(dockerfile, /^\s*(ENV|ARG)\b[^\n]*\bVERCEL/m);
  assert.doesNotMatch(dockerfile.match(/FROM \$\{NODE_IMAGE\} AS run[\s\S]*$/)[0], /VERCEL/);
  // Not in compose: neither the environment block nor the build args.
  assert.doesNotMatch(COMPOSE, /^\s*-?\s*VERCEL\w*\s*[:=]/m);
  // Not in app.env (the env_file): write-app-env writes no VERCEL* name.
  assert.equal(ALL_NAMES.filter((n) => n.startsWith('VERCEL')).length, 0);
  const env = appEnv(Object.fromEntries([...Object.values(SECRET_NAMES), SESSION_SECRET.from].map((n) => [n, 'x']))).text;
  assert.doesNotMatch(env, /^VERCEL/m);
});

test('the base image is pinned by digest and the build context excludes keys', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:22\.23\.3-alpine@sha256:[0-9a-f]{64}$/m);
  const ignore = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8').split('\n');
  for (const pattern of ['.env*', '**/.env*', 'app.env', '**/app.env', '*.pem', '**/*.pem', '*.key', '**/*.key']) {
    assert.ok(ignore.includes(pattern), pattern);
  }
});
