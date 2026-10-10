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
// <target>/api/webhooks/calcom, exactly as cal.com would. The row is marked
// resolved only when the answer says the booking was APPLIED there (the local
// handler ran: a body with `matched`) or FORWARDED onward. A 2xx that only says
// it was held again (e.g. the target's CALCOM_BOOKING_OWNERS still does not
// match) or ignored leaves the row open. The receiving route is idempotent per
// booking uid, so a replay of something already applied is a no-op there. Without --apply it
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

/**
 * What the webhook's answer means for a replay. Only 'applied' and 'forwarded'
 * resolve a held row.
 *   applied   the target processed the booking itself (its local handler
 *             answers { ok: true, matched: ... }, deduped or not)
 *   forwarded the target passed it to the deployment that owns it
 *   held      the target held it again; nothing was applied
 */
export function replayOutcome(status, json) {
  if (status < 200 || status >= 300 || !json || typeof json !== 'object') return 'failed';
  if (json.held === true) return 'held';
  if (json.forwarded === true) return 'forwarded';
  if (json.ok === true && 'matched' in json) return 'applied';
  if ('ignored' in json) return 'ignored';
  return 'unexpected';
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
    let json = null;
    try { json = await res.json(); } catch { /* not JSON: not an applied answer */ }
    const outcome = replayOutcome(res.status, json);
    return { ok: outcome === 'applied' || outcome === 'forwarded', status: res.status, outcome };
  } catch (err) {
    return { ok: false, status: 0, outcome: 'failed', detail: err instanceof Error ? err.name : 'error' };
  }
}

const label = (r) => `${String(r.id).slice(0, 8)} ${r.received_at} ${r.trigger_event ?? '-'} target=${r.target_session_id ? String(r.target_session_id).slice(0, 8) : 'none'}${'alerted_at' in r ? ` alerted=${r.alerted_at ? 'yes' : 'NO'}` : ''} reason="${r.reason}"`;

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
      .select('id, received_at, trigger_event, reason, target_session_id, alerted_at')
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
  console.log(`target answered ${result.status}: ${result.outcome}${result.detail ? ` (${result.detail})` : ''}`);
  if (!result.ok) {
    console.log('not resolved: only an applied or forwarded answer resolves a held booking');
    process.exitCode = 1;
  }
  else {
    const { error } = await db.from('calcom_held_bookings')
      .update({ resolved_at: new Date().toISOString(), resolution: `replayed to ${args.target}: ${result.outcome} (${result.status})` })
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
