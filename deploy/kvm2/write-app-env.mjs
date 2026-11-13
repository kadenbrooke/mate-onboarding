/**
 * Writes Mate's KVM2 app.env to stdout from the amos secret helper's names, for a pipe into ssh.
 * It never writes to a terminal (a value must not reach a screen or a transcript), never prints a
 * value on stderr, and refuses when any required name is missing or holds a character the env file
 * cannot carry safely (line break, NUL, quote, backslash, "$", whitespace).
 *
 * The 32 names are exactly the ones Vercel production held for mate-onboarding on 2026-11-13
 * (`vercel env ls production`). QBO_CLIENT_SECRET is deliberately absent: only the KVM2 n8n rail
 * calls Intuit (docs/qbo/kvm2-rail.md).
 *
 * The ssh pipe must run INSIDE the `secret run` child (sh -c), never after it: `secret run` masks its
 * child's stdout, so `secret run ... | ssh` writes "[redacted NAME]" placeholders instead of the values
 * (the Swingin clock's first go-live, 2026-11-12). The QBO values come from two helper logins, and
 * `secret run` takes one --login, so it runs twice, nested. The same command as docs/deploy/kvm2.md
 * "Bring it up" step 2:
 *
 *   node ~/kaden/amos/scripts/secrets/secret.mjs run --login "QuickBooks Online PRODUCTION keys (added 2026-08-06)" \
 *     -- node ~/kaden/amos/scripts/secrets/secret.mjs run --login "QBO generated secrets (DEL-14, 2026-08-06) — used by local + KVM2 rail (PROXY_SECRET must match the n8n QBO Live Proxy)" \
 *     -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -e SUPABASE_SECRET_KEY -e OPENAI_API_KEY -e GEMINI_API_KEY \
 *     -e GEMINI_API_KEY_CARSON -e PORTKEY_GATEWAY_KEY -e TELNYX_API_KEY -e LEADS_INGEST_TOKEN \
 *     -e CALCOM_WEBHOOK_SECRET -e CAL_JC_API_KEY -e META_JC_AD_ACCOUNT -e META_JC_PAGE_TOKEN \
 *     -e LEAD_INTAKE_WEBHOOK_URL -e LEAD_INTAKE_SECRET -e GOOGLE_OAUTH_CLIENT_ID -e GOOGLE_OAUTH_CLIENT_SECRET \
 *     -e GOOGLE_OAUTH_REDIRECT_URI -e MATE_AGENT_TOKEN -e MATE_ADS_CRON_SECRET -e MATE_SESSION_SECRET \
 *     -- sh -c 'node "$1/deploy/kvm2/write-app-env.mjs" $3 | ssh "$2" "set -e; umask 077; mkdir -p /opt/mate; cat > /opt/mate/app.env.new; chmod 600 /opt/mate/app.env.new; mv /opt/mate/app.env.new /opt/mate/app.env"' \
 *     sh "$REPO" "$KVM2" "$WRITE_ARGS"
 *
 * Arguments (in $WRITE_ARGS above; empty for the normal case):
 *   --session-secret helper     (default) MATE_SESSION_SECRET comes from the helper; refuses if it is
 *                               not there.
 *   --session-secret generate   a new random MATE_SESSION_SECRET, written only into the pipe and never
 *                               stored. Every signed mate_session cookie stops verifying (those
 *                               visitors fall back to their session link), and the next run makes
 *                               another one, so prefer storing one in the helper first
 *                               (docs/deploy/kvm2.md "MATE_SESSION_SECRET").
 *   --check                     write nothing; say whether every value is present and safe (names only).
 *                               Runs with stdout on a terminal, since it never writes a value.
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// app.env name -> amos secret helper name. LOGIN_* come from `secret run --login` (passwords.md entries).
export const SECRET_NAMES = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  SUPABASE_SECRET_KEY: 'SUPABASE_SECRET_KEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  GEMINI_API_KEY_CARSON: 'GEMINI_API_KEY_CARSON',
  PORTKEY_GATEWAY_KEY: 'PORTKEY_GATEWAY_KEY',
  TELNYX_API_KEY: 'TELNYX_API_KEY',
  LEADS_INGEST_TOKEN: 'LEADS_INGEST_TOKEN',
  CALCOM_WEBHOOK_SECRET: 'CALCOM_WEBHOOK_SECRET',
  CAL_JC_API_KEY: 'CAL_JC_API_KEY',
  META_JC_AD_ACCOUNT: 'META_JC_AD_ACCOUNT',
  META_JC_PAGE_TOKEN: 'META_JC_PAGE_TOKEN',
  LEAD_INTAKE_WEBHOOK_URL: 'LEAD_INTAKE_WEBHOOK_URL',
  LEAD_INTAKE_SECRET: 'LEAD_INTAKE_SECRET',
  GOOGLE_OAUTH_CLIENT_ID: 'GOOGLE_OAUTH_CLIENT_ID',
  GOOGLE_OAUTH_CLIENT_SECRET: 'GOOGLE_OAUTH_CLIENT_SECRET',
  GOOGLE_OAUTH_REDIRECT_URI: 'GOOGLE_OAUTH_REDIRECT_URI',
  MATE_AGENT_TOKEN: 'MATE_AGENT_TOKEN',
  // The cron secret added with the J&C Meta ads refresh (2026-07-28), not amos-ui's CRON_SECRET.
  CRON_SECRET: 'MATE_ADS_CRON_SECRET',
  QBO_CLIENT_ID: 'LOGIN_QBO_CLIENT_ID_PROD',
  QBO_STATE_SECRET: 'LOGIN_QBO_STATE_SECRET',
  QBO_PROXY_SECRET: 'LOGIN_QBO_PROXY_SECRET',
};
export const SESSION_SECRET = { name: 'MATE_SESSION_SECRET', from: 'MATE_SESSION_SECRET' };

// Not secrets: public values the Vercel project held, rebuilt here.
export const FIXED = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://jeqnvdlfybpmbovywknz.supabase.co',
  PORTKEY_BASE_URL: 'https://portkey.auto-mate.business',
  QBO_ENVIRONMENT: 'production',
  QBO_REDIRECT_URI: 'https://mate.auto-mate.business/api/qb/callback',
  QBO_RAIL_EXCHANGE_URL: 'https://n8n.auto-mate.business/webhook/qbo-exchange',
  // J&C's real dashboard session (wiki/clients/jc-asphalt-paving.md; src/lib/demo/geminiKey.ts).
  META_JC_SESSION_ID: '61400e73-0570-4167-88d9-d3a69650b15b',
  JC_ONBOARDING_SESSION_ID: '61400e73-0570-4167-88d9-d3a69650b15b',
  MATE_TELNYX_NUMBER: '+13854409882',
  DEMO_TELNYX_NUMBER: '+13854409744',
};

// What an env file line can carry as-is, for both compose's env_file and its --env-file
// interpolation: no line break, NUL, quote, backslash, "$" (compose would expand it) or whitespace.
const UNSAFE = /[\r\n\0"'`\\$\s]/;

/** Every app.env name, in the order the file is written. */
export const ALL_NAMES = [...Object.keys(FIXED), ...Object.keys(SECRET_NAMES), SESSION_SECRET.name];

/** The env file's text, or {error} naming (never showing) what is wrong. */
export function appEnv(env, { sessionSecret = 'helper', generate = () => randomBytes(32).toString('hex') } = {}) {
  const missing = [];
  const bad = [];
  const lines = [];
  const add = (name, from, value) => {
    if (!value) missing.push(from);
    else if (UNSAFE.test(value)) bad.push(from);
    else lines.push(`${name}=${value}`);
  };
  for (const [name, value] of Object.entries(FIXED)) lines.push(`${name}=${value}`);
  for (const [name, from] of Object.entries(SECRET_NAMES)) add(name, from, env[from]?.trim());
  if (sessionSecret === 'generate') lines.push(`${SESSION_SECRET.name}=${generate()}`);
  else add(SESSION_SECRET.name, SESSION_SECRET.from, env[SESSION_SECRET.from]?.trim());
  if (missing.length) return { error: `missing from the secret helper: ${missing.join(', ')}` };
  if (bad.length) return { error: `holds a line break, quote, "$", backslash or space, refusing: ${bad.join(', ')}` };
  return { text: `${lines.join('\n')}\n` };
}

export function parseArgs(argv) {
  const out = { sessionSecret: 'helper', check: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check' && !out.check) out.check = true;
    else if (argv[i] === '--session-secret' && ['helper', 'generate'].includes(argv[i + 1])) out.sessionSecret = argv[++i];
    else return null;
  }
  return out;
}

// Run as a script (any relative or symlinked path), not when imported by the tests.
const invoked = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: write-app-env.mjs [--session-secret helper|generate] [--check]  (stdout must be a pipe unless --check)');
    process.exit(2);
  }
  if (!args.check && process.stdout.isTTY) {
    console.error('refusing: stdout is a terminal; pipe it into ssh (see the top of this file)');
    process.exit(2);
  }
  const result = appEnv(process.env, args);
  if (result.error) {
    console.error(`FAIL ${result.error}. Nothing written.`);
    process.exit(1);
  }
  const generated = args.sessionSecret === 'generate' ? ' (MATE_SESSION_SECRET newly generated, not stored anywhere else)' : '';
  if (args.check) {
    console.error(`OK every value present and safe, ${ALL_NAMES.length} names${generated}. Nothing written (--check).`);
  } else {
    process.stdout.write(result.text);
    console.error(`OK app.env, ${ALL_NAMES.length} names: ${ALL_NAMES.join(', ')}${generated}`);
  }
}
