#!/usr/bin/env node
// Create or reset the provider-free practice CRM tenant.
//
// Usage: node scripts/reset-practice-crm.mjs
// Required env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.
// Optional env: PRACTICE_LOGIN_EMAIL and PRACTICE_LOGIN_PASSWORD.
// Remote safety: set PRACTICE_RESET_CONFIRM=YES for a non-local Supabase URL.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  buildPracticeLeads, buildPracticeMessages, buildPracticePayments, buildPracticeZoneRows,
  PRACTICE_COMPANY_NAME, PRACTICE_LOGIN_EMAIL, PRACTICE_SESSION_ID,
} from './practice-fixtures.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required');
const local = /localhost|127\.0\.0\.1|::1/.test(url);
if (!local && process.env.PRACTICE_RESET_CONFIRM !== 'YES') {
  throw new Error('Refusing remote reset. Set PRACTICE_RESET_CONFIRM=YES only for an intentional test database reset.');
}

const supabase = createClient(url, key);
const asOf = new Date().toISOString();

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function clearSessionRows() {
  // Delete children first. Every delete is scoped to the one synthetic tenant.
  for (const table of [
    'lead_messages', 'client_lead_payments', 'lead_postcall', 'client_events',
    'client_appointments', 'client_reactivation_wins', 'client_reactivation',
    'client_reviews', 'client_reputation', 'ad_metrics', 'qb_metrics', 'qb_connections',
    'handoff_signals', 'client_incidents', 'client_leads',
  ]) {
    await must(`clear ${table}`, supabase.from(table).delete().eq('session_id', PRACTICE_SESSION_ID));
  }
}

async function ensurePracticeLogin() {
  const email = (process.env.PRACTICE_LOGIN_EMAIL || PRACTICE_LOGIN_EMAIL).toLowerCase();
  const password = process.env.PRACTICE_LOGIN_PASSWORD || `Practice-${crypto.randomBytes(12).toString('hex')}`;
  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`find practice login: ${listed.error.message}`);
  let user = listed.data.users.find(candidate => candidate.email?.toLowerCase() === email);
  let created = false;
  if (!user) {
    const result = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) throw new Error(`create practice login: ${result.error?.message || 'no user returned'}`);
    user = result.data.user;
    created = true;
  } else {
    const result = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (result.error) throw new Error(`reset practice login password: ${result.error.message}`);
  }

  const memberships = await must('read practice memberships', supabase.from('portal_members').select('session_id').eq('user_id', user.id));
  const foreign = (memberships || []).filter(row => row.session_id !== PRACTICE_SESSION_ID);
  if (foreign.length) throw new Error(`practice login already belongs to another tenant: ${email}`);
  if (!(memberships || []).some(row => row.session_id === PRACTICE_SESSION_ID)) {
    await must('create practice membership', supabase.from('portal_members').insert({
      user_id: user.id, email, session_id: PRACTICE_SESSION_ID, role: 'owner',
    }));
  }
  return { email, password, created };
}

async function main() {
  const now = new Date().toISOString();
  // PRACTICE_SESSION_ID stays fixed so every reset is idempotent for one tenant.
  await must('create or reset practice session', supabase.from('onboarding_sessions').upsert({
    id: PRACTICE_SESSION_ID,
    mate_name: 'Practice Mate',
    is_demo: false,
    is_practice: true,
    step: 'ready',
    status: 'complete',
    collected: {
      company: { name: PRACTICE_COMPANY_NAME, email: 'office@example.com' },
      current_phone: '+18015550199',
      service_area: 'Utah County, Utah',
      services: ['Driveway resurfacing', 'Parking lot paving', 'Sealcoating'],
    },
    agent_enabled: false,
    operator_phone: '+18015550199',
    onboarding_form_url: 'https://example.com/practice-form',
    faq_url: 'https://example.com/practice-faq',
    created_at: now,
    updated_at: now,
  }, { onConflict: 'id' }));
  await clearSessionRows();

  const leads = buildPracticeLeads(asOf);
  const inserted = await must('seed practice leads', supabase.from('client_leads').insert(leads).select('id, phone'));
  const messages = buildPracticeMessages(leads.map((lead, i) => ({ ...lead, id: inserted[i].id })), asOf);
  await must('seed practice conversations', supabase.from('lead_messages').insert(messages));
  await must('seed practice payments', supabase.from('client_lead_payments').insert(buildPracticePayments(leads, inserted, asOf)));

  const zones = buildPracticeZoneRows(asOf);
  for (const [label, table, rows] of [
    ['practice events', 'client_events', zones.events],
    ['practice appointments', 'client_appointments', zones.appointments],
    ['practice reactivation wins', 'client_reactivation_wins', zones.reactivationWins],
    ['practice reviews', 'client_reviews', zones.reviews],
    ['practice ad metrics', 'ad_metrics', zones.ads],
  ]) await must(label, supabase.from(table).insert(rows));
  await must('seed practice reactivation', supabase.from('client_reactivation').upsert(zones.reactivation, { onConflict: 'session_id' }));
  await must('seed practice reputation', supabase.from('client_reputation').upsert(zones.reputation, { onConflict: 'session_id' }));
  await must('seed practice QBO snapshot', supabase.from('qb_metrics').insert(zones.qbMetrics));

  const login = await ensurePracticeLogin();
  console.log(`Practice tenant reset: ${PRACTICE_SESSION_ID}`);
  console.log(`Dashboard: /dash/${PRACTICE_SESSION_ID}`);
  console.log(`Login: ${login.email}`);
  console.log(`Password: ${login.password}`);
  console.log(`Leads: ${leads.length}; conversation messages: ${messages.length}; payments: ${buildPracticePayments(leads, inserted, asOf).length}`);
  if (login.created) console.log('Created the dedicated practice login.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
