// scripts/seed-demo-leads.mjs
// Seeds ~40 believable leads for one session so every widget renders.
// Usage: node scripts/seed-demo-leads.mjs <session_id> [--skip-leads] [--locked]
//   --skip-leads  skip the client_leads insert (avoids piling duplicate leads onto an existing demo session)
//   --locked      reset the session so every gated zone is locked, for walking
//                 the unlock flow end to end. Leads are still seeded (unless
//                 --skip-leads), so the always-live zones render and the
//                 contrast between live and locked is visible.
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const sessionId = args.find(a => !a.startsWith('--'));
const skipLeads = args.includes('--skip-leads');
const locked = args.includes('--locked');

if (!sessionId) {
  console.error('usage: node scripts/seed-demo-leads.mjs <session_id> [--skip-leads] [--locked]');
  process.exit(1);
}

// The session id must always be passed explicitly. A default would let a reset
// land on the wrong session, which is the same class of mistake that put a
// client's real leads on a public page.
if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
  console.error(`refusing to run: "${sessionId}" is not a session uuid`);
  process.exit(1);
}

// Hard blocklist for the destructive --locked reset: never mutate the
// prospect-facing demo (b7573135) or the real J&C production session
// (61400e73). The walkthrough demo must be its own separate is_demo session.
const PROTECTED_SESSIONS = new Set([
  'b7573135-d4ec-43bb-bf33-a1d365739784', // prospect demo
  '61400e73-0570-4167-88d9-d3a69650b15b', // real J&C
]);
if (locked && PROTECTED_SESSIONS.has(sessionId.toLowerCase())) {
  console.error(`refusing to run --locked against protected session ${sessionId}`);
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

if (locked) {
  // Clear every gate signal: no google_connected, agent off, no operator phone,
  // and remove any ad_metrics rows so the ads zone gates on data absence.
  const { error } = await supabase
    .from('onboarding_sessions')
    .update({ collected: {}, agent_enabled: false, operator_phone: null })
    .eq('id', sessionId);
  if (error) { console.error('lock reset failed', error); process.exit(1); }

  const { error: adErr } = await supabase.from('ad_metrics').delete().eq('session_id', sessionId);
  if (adErr) { console.error('ad_metrics clear failed', adErr); process.exit(1); }

  console.log(`locked session ${sessionId}: google/agent/phone cleared, ad_metrics removed`);
}

async function insertOrDie(table, rows) {
  const { error } = await supabase.from(table).insert(rows);
  if (error) { console.error(table, error); process.exit(1); }
}
async function upsertOrDie(table, row) {
  const { error } = await supabase.from(table).upsert(row);
  if (error) { console.error(table, error); process.exit(1); }
}

const CITIES = ['Orem','Provo','Lehi','Springville'];
const SERVICES = ['Driveway','Parking lot','Sealcoat'];
const SOURCES = ['missed_call','missed_call','texted_in','texted_in','web_form','referral','revived'];
const NAMES = ['Mike R.','Dana W.','Carl B.','Joe M.','Karen B.','Todd R.','Amy S.','Luis G.','Pat H.','Sam T.'];

if (!skipLeads) {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 42);
    const status = Math.random() < 0.22 ? 'won' : Math.random() < 0.12 ? 'lost' : 'open';
    return {
      session_id: sessionId,
      name: NAMES[i % NAMES.length],
      city: CITIES[Math.floor(Math.random() * CITIES.length)],
      service: SERVICES[Math.floor(Math.random() * SERVICES.length)],
      source: SOURCES[Math.floor(Math.random() * SOURCES.length)],
      referrer_name: Math.random() < 0.15 ? 'Joe M.' : null,
      score: 40 + Math.floor(Math.random() * 60),
      status,
      quote_cents: (2000 + Math.floor(Math.random() * 6000)) * 100,
      contacted: Math.random() < 0.7,
      after_hours: Math.random() < 0.3,
      first_reply_seconds: 15 + Math.floor(Math.random() * 40),
      created_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      status_updated_at: status === 'open' ? null : new Date().toISOString(),
    };
  });

  await insertOrDie('client_leads', rows);
  console.log(`seeded ${rows.length} leads for session ${sessionId}`);
} else {
  console.log('skipping client_leads insert (--skip-leads)');
}

// Plan-2 zone data
const now = Date.now();
const events = Array.from({ length: 25 }, (_, i) => {
  const kinds = [
    { agent: 'first_responder', kind: 'reply', message: `${NAMES[i % NAMES.length]} texted back in ${3 + (i % 10)}s` },
    { agent: 'first_responder', kind: 'missed_call', message: `Missed call rescued from ${NAMES[(i + 2) % NAMES.length]}` },
    { agent: 'reactivator', kind: 'rebooked', message: `${NAMES[(i + 4) % NAMES.length]} rebooked after ${3 + (i % 14)}mo` },
    { agent: 'reputation', kind: 'review', message: `New 5 star review from ${NAMES[(i + 6) % NAMES.length]}` },
  ];
  return {
    session_id: sessionId, ...kinds[i % kinds.length],
    created_at: new Date(now - i * 3600_000 * 5).toISOString(),
  };
});
await insertOrDie('client_events', events);

const appts = Array.from({ length: 14 }, (_, i) => ({
  session_id: sessionId,
  customer_name: NAMES[i % NAMES.length],
  service: SERVICES[i % SERVICES.length],
  price_cents: (2500 + (i % 5) * 900) * 100,
  starts_at: new Date(now + (i - 6) * 86400_000 * 2 + 17 * 3600_000).toISOString(),
}));
await insertOrDie('client_appointments', appts);

await upsertOrDie('client_reactivation', {
  session_id: sessionId, pool_size: 740, contacted: 156, replied: 26, rebooked: 9,
  recovered_cents: 1140000, dormancy_3_6mo: 210, dormancy_6_12mo: 260,
  dormancy_1_2yr: 180, dormancy_2yr_plus: 90,
});
await insertOrDie('client_reactivation_wins', [
  { session_id: sessionId, customer_name: 'Mike H.', dormant_months: 8, won_cents: 35000, state: 'won' },
  { session_id: sessionId, customer_name: 'Karen B.', dormant_months: 14, won_cents: 24000, state: 'won' },
  { session_id: sessionId, customer_name: 'Todd R.', dormant_months: 6, won_cents: null, state: 'replied' },
]);

await upsertOrDie('client_reputation', {
  session_id: sessionId, jobs_done: 21, rate_asks: 19, rated_45: 12, on_google: 9,
  refer_asks: 12, referrals_in: 7, referrals_closed: 4, referrals_lost: 1,
  referral_revenue_cents: 1230000, avg_rating: 4.8,
});
const reviews = Array.from({ length: 47 }, (_, i) => ({
  session_id: sessionId,
  rating: i < 38 ? 5 : i < 45 ? 4 : 3,
  author: NAMES[i % NAMES.length],
  created_at: new Date(now - i * 86400_000 * 3).toISOString(),
}));
await insertOrDie('client_reviews', reviews);
// no incidents seeded: pulse should read green

console.log('seeded plan-2 zone data');
