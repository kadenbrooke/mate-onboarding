// Offline tests: npm run test:deploy (node --test deploy/kvm2/*.test.mjs)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ALL_NAMES, FIXED, SECRET_NAMES, SESSION_SECRET, appEnv, parseArgs } from './write-app-env.mjs';

const fake = () => Object.fromEntries([...Object.values(SECRET_NAMES), SESSION_SECRET.from].map((from, i) => [from, `value-${i}`]));
const script = fileURLToPath(new URL('./write-app-env.mjs', import.meta.url));
const run = (args, env, opts = {}) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', ...opts });

// `vercel env ls production` for mate-onboarding, 2026-11-13 (names only).
const VERCEL_PRODUCTION = [
  'MATE_AGENT_TOKEN', 'GEMINI_API_KEY_CARSON', 'PORTKEY_GATEWAY_KEY', 'LEAD_INTAKE_WEBHOOK_URL', 'LEAD_INTAKE_SECRET',
  'META_JC_PAGE_TOKEN', 'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'QBO_ENVIRONMENT',
  'QBO_CLIENT_ID', 'QBO_PROXY_SECRET', 'QBO_RAIL_EXCHANGE_URL', 'QBO_STATE_SECRET', 'QBO_REDIRECT_URI', 'CALCOM_WEBHOOK_SECRET',
  'CAL_JC_API_KEY', 'JC_ONBOARDING_SESSION_ID', 'META_JC_SESSION_ID', 'TELNYX_API_KEY', 'MATE_TELNYX_NUMBER', 'CRON_SECRET',
  'META_JC_AD_ACCOUNT', 'LEADS_INGEST_TOKEN', 'GEMINI_API_KEY', 'PORTKEY_BASE_URL', 'DEMO_TELNYX_NUMBER', 'MATE_SESSION_SECRET',
  'OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL',
];

test('writes exactly the 32 names Vercel production held, fixed values first, no QBO client secret', () => {
  const { text, error } = appEnv(fake());
  assert.equal(error, undefined);
  const names = text.trimEnd().split('\n').map((l) => l.split('=')[0]);
  assert.deepEqual(names, ALL_NAMES);
  assert.equal(names.length, 32);
  assert.deepEqual([...names].sort(), [...VERCEL_PRODUCTION].sort());
  assert.ok(!names.includes('QBO_CLIENT_SECRET'));
  assert.match(text, /^QBO_ENVIRONMENT=production$/m);
  assert.match(text, /^NEXT_PUBLIC_SUPABASE_URL=https:\/\/jeqnvdlfybpmbovywknz\.supabase\.co$/m);
  assert.match(text, /^QBO_REDIRECT_URI=https:\/\/mate\.auto-mate\.business\/api\/qb\/callback$/m);
});

test('CRON_SECRET comes from MATE_ADS_CRON_SECRET and QBO from the two helper logins', () => {
  assert.equal(SECRET_NAMES.CRON_SECRET, 'MATE_ADS_CRON_SECRET');
  assert.equal(SECRET_NAMES.QBO_CLIENT_ID, 'LOGIN_QBO_CLIENT_ID_PROD');
  const env = { ...fake(), MATE_ADS_CRON_SECRET: 'the-cron-one', CRON_SECRET: 'amos-ui-one' };
  assert.match(appEnv(env).text, /^CRON_SECRET=the-cron-one$/m);
  assert.doesNotMatch(appEnv(env).text, /amos-ui-one/);
});

test('both J&C session ids are the real J&C session, never the public demo', () => {
  assert.equal(FIXED.META_JC_SESSION_ID, '61400e73-0570-4167-88d9-d3a69650b15b');
  assert.equal(FIXED.JC_ONBOARDING_SESSION_ID, FIXED.META_JC_SESSION_ID);
  const demo = readFileSync(new URL('../../src/lib/portal/demo.ts', import.meta.url), 'utf8').match(/DEMO_SESSION_ID = "([^"]+)"/)[1];
  assert.notEqual(FIXED.META_JC_SESSION_ID, demo);
});

test('refuses a missing or unsafe value and names it without showing any value', () => {
  const env = { ...fake(), TELNYX_API_KEY: '', SUPABASE_SECRET_KEY: 'two\nlines' };
  const missing = appEnv(env);
  assert.equal(missing.text, undefined);
  assert.equal(missing.error, 'missing from the secret helper: TELNYX_API_KEY');
  for (const unsafe of ['two\nlines', 'has$dollar', "has'quote", 'has"quote', 'has\\slash', 'has space']) {
    const bad = appEnv({ ...fake(), SUPABASE_SECRET_KEY: unsafe });
    assert.equal(bad.error, 'holds a line break, quote, "$", backslash or space, refusing: SUPABASE_SECRET_KEY', JSON.stringify(unsafe));
    assert.ok(!bad.error.includes(unsafe));
  }
});

test('MATE_SESSION_SECRET: from the helper by default, generated only when asked', () => {
  const env = fake();
  delete env.MATE_SESSION_SECRET;
  assert.equal(appEnv(env).error, 'missing from the secret helper: MATE_SESSION_SECRET');
  const generated = appEnv(env, { sessionSecret: 'generate' });
  assert.equal(generated.error, undefined);
  const value = generated.text.match(/^MATE_SESSION_SECRET=([0-9a-f]+)$/m)?.[1];
  assert.equal(value?.length, 64);
  assert.notEqual(appEnv(env, { sessionSecret: 'generate' }).text, generated.text, 'a fresh one each run');
  // generate wins over a helper value: the flag is an explicit choice.
  assert.doesNotMatch(appEnv(fake(), { sessionSecret: 'generate' }).text, /^MATE_SESSION_SECRET=value-/m);
});

test('arguments: --session-secret helper|generate and --check only', () => {
  assert.deepEqual(parseArgs([]), { sessionSecret: 'helper', check: false });
  assert.deepEqual(parseArgs(['--session-secret', 'generate']), { sessionSecret: 'generate', check: false });
  assert.deepEqual(parseArgs(['--check', '--session-secret', 'helper']), { sessionSecret: 'helper', check: true });
  for (const bad of [['--session-secret'], ['--session-secret', 'new'], ['--check', '--check'], ['--preview', 'on'], ['generate']]) {
    assert.equal(parseArgs(bad), null, bad.join(' '));
  }
});

test('the CLI writes only to a pipe, and stderr lists names, never values', () => {
  const out = run([], fake());
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^CRON_SECRET=value-\d+$/m);
  assert.ok(!/value-/.test(out.stderr));
  const generated = run(['--session-secret', 'generate'], fake());
  assert.equal(generated.status, 0, generated.stderr);
  const secret = generated.stdout.match(/^MATE_SESSION_SECRET=(.+)$/m)[1];
  assert.ok(!generated.stderr.includes(secret));
  assert.match(generated.stderr, /newly generated/);
  const failed = run([], {});
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.equal(run(['--nope'], fake()).status, 2);
});

test('--check writes nothing, even with every value present', () => {
  const ok = run(['--check'], fake());
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, '');
  assert.match(ok.stderr, /^OK every value present and safe, 32 names/);
  const bad = run(['--check'], { ...fake(), META_JC_PAGE_TOKEN: '' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
});

test('a relative invocation runs too (it is not mistaken for an import)', () => {
  const here = dirname(script);
  for (const [cwd, arg] of [[here, 'write-app-env.mjs'], [dirname(dirname(here)), 'deploy/kvm2/write-app-env.mjs'], [here, './write-app-env.mjs']]) {
    const out = spawnSync(process.execPath, [arg], { cwd, env: { PATH: process.env.PATH, ...fake() }, encoding: 'utf8' });
    assert.equal(out.status, 0, `${arg}: ${out.stderr}`);
    assert.match(out.stdout, /^QBO_ENVIRONMENT=production$/m, arg);
  }
});

test('the usage comment runs the ssh pipe inside secret run, exactly as the runbook does', () => {
  const pipe = (text) => text.match(/-- sh -c '(node "\$1\/deploy\/kvm2\/write-app-env\.mjs" \$3 \| ssh "\$2" "[^"]+")'/)?.[1];
  const flags = (text) => text.match(/(?:^|\n)[ *]*(node ~\/kaden\/amos\/scripts\/secrets\/secret\.mjs run --login[\s\S]*?)-- sh -c/)?.[1].replace(/[\s*\\]+/g, ' ').trim();
  const comment = readFileSync(script, 'utf8');
  const runbook = readFileSync(new URL('../../docs/deploy/kvm2.md', import.meta.url), 'utf8');
  assert.ok(pipe(runbook), 'the runbook has the sh -c pipe');
  assert.equal(pipe(comment), pipe(runbook));
  assert.ok(flags(runbook), 'the runbook has the secret run flags');
  assert.equal(flags(comment), flags(runbook));
  // Every helper name the script reads is loaded by the command (logins aside).
  for (const from of [...Object.values(SECRET_NAMES), SESSION_SECRET.from].filter((n) => !n.startsWith('LOGIN_'))) {
    assert.match(flags(runbook), new RegExp(`-e ${from}\\b`), from);
  }
  // Never the masked form: a pipe that starts after the secret run child.
  for (const text of [comment, runbook]) assert.doesNotMatch(text, /write-app-env\.mjs"?[^|\n]*\\?\s*\n\s*\*?\s*\| ssh/);
});
