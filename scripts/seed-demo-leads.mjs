// scripts/seed-demo-leads.mjs
// Seeds ~40 believable leads for one session so every widget renders.
// Usage: node scripts/seed-demo-leads.mjs <session_id>
import { createClient } from '@supabase/supabase-js';

const [sessionId] = process.argv.slice(2);
if (!sessionId) { console.error('usage: node scripts/seed-demo-leads.mjs <session_id>'); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const CITIES = ['Orem','Provo','Lehi','Springville'];
const SERVICES = ['Driveway','Parking lot','Sealcoat'];
const SOURCES = ['missed_call','missed_call','texted_in','texted_in','web_form','referral','revived'];
const NAMES = ['Mike R.','Dana W.','Carl B.','Joe M.','Karen B.','Todd R.','Amy S.','Luis G.','Pat H.','Sam T.'];

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

const { error } = await supabase.from('client_leads').insert(rows);
if (error) { console.error(error); process.exit(1); }
console.log(`seeded ${rows.length} leads for session ${sessionId}`);
