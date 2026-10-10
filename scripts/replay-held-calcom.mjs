#!/usr/bin/env node
// Reconcile cal.com bookings held by the shared deployment
// (calcom_held_bookings, src/lib/calcom/held.ts).
//
// Usage (env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY of the CONTROL
// project, CALCOM_WEBHOOK_SECRET; run through the amos secret helper):
//   node scripts/replay-held-calcom.mjs                      list open held rows
//   node scripts/replay-held-calcom.mjs --replay <id-prefix> --target https://<host> [--apply]
//   node scripts/replay-held-calcom.mjs --resolve <id-prefix> --note "<why>" [--apply]
//
// --replay re-signs the stored body with CALCOM_WEBHOOK_SECRET and POSTs it to
// <target>/api/webhooks/calcom, exactly as cal.com would, then marks the row
// resolved on a 2xx. The receiving route is idempotent per booking uid, so a
// replay of something already applied is a no-op there. Without --apply it
// only says what it would do. Output names rows by id prefix and reason, never
// by anything inside the booking.

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function signBody(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--replay' || a === '--resolve' || a === '--target' || a === '--note') out[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.replay && out.resolve) throw new Error('--replay and --resolve are separate runs');
  if (out.replay && !out.target) throw new Error('--replay needs --target https://<host>');
  if (out.target) {
    const u = new URL(out.target);
    if (u.protocol !== 'https:' || u.origin !== out.target.replace(/\/+$/, '')) throw new Error('--target must be a bare https origin');
    out.target = u.origin;
  }
  if (out.resolve && !out.note) throw new Error('--resolve needs --note');
  return out;
}

/** POST one held row to the target as cal.com would. Never throws. */
export async function replayRow(row, { target, secret, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(new URL('/api/webhooks/calcom', target), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cal-signature-256': signBody(row.raw_body, secret) },
      body: row.raw_body,
      redirect: 'manual',
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.name : 'error' };
  }
}

const label = (r) => `${String(r.id).slice(0, 8)} ${r.received_at} ${r.trigger_event ?? '-'} target=${r.target_session_id ? String(r.target_session_id).slice(0, 8) : 'none'} reason="${r.reason}"`;

async function findOne(db, prefix) {
  const { data, error } = await db.from('calcom_held_bookings')
    .select('id, received_at, trigger_event, reason, target_session_id, raw_body')
    .is('resolved_at', null);
  if (error) throw new Error(error.message);
  const hits = (data ?? []).filter((r) => String(r.id).startsWith(prefix));
  if (hits.length !== 1) throw new Error(`${hits.length} open rows match ${prefix}`);
  return hits[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (control project) are required');
  const db = createClient(url, key, { auth: { persistSession: false } });

  if (!args.replay && !args.resolve) {
    const { data, error } = await db.from('calcom_held_bookings')
      .select('id, received_at, trigger_event, reason, target_session_id')
      .is('resolved_at', null)
      .order('received_at', { ascending: true });
    if (error) throw new Error(error.message);
    console.log(`${(data ?? []).length} open held booking(s)`);
    for (const r of data ?? []) console.log(label(r));
    return;
  }

  const row = await findOne(db, args.replay ?? args.resolve);
  if (args.resolve) {
    console.log(`${args.apply ? 'resolving' : 'would resolve'} ${label(row)}`);
    if (!args.apply) return;
    const { error } = await db.from('calcom_held_bookings')
      .update({ resolved_at: new Date().toISOString(), resolution: `resolved by hand: ${args.note}` })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    return;
  }

  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) throw new Error('CALCOM_WEBHOOK_SECRET is required to replay');
  console.log(`${args.apply ? 'replaying' : 'would replay'} ${label(row)} -> ${args.target}`);
  if (!args.apply) return;
  const result = await replayRow(row, { target: args.target, secret });
  console.log(`target answered ${result.status}${result.detail ? ` (${result.detail})` : ''}`);
  if (!result.ok) process.exitCode = 1;
  else {
    const { error } = await db.from('calcom_held_bookings')
      .update({ resolved_at: new Date().toISOString(), resolution: `replayed to ${args.target} (${result.status})` })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`replay-held-calcom: ${err.message}`);
    process.exit(1);
  });
}
