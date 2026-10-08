export const PRACTICE_SESSION_ID = 'cccccccc-0000-4000-8000-000000000003';
export const PRACTICE_LOGIN_EMAIL = 'aranza.practice@example.com';
export const PRACTICE_COMPANY_NAME = 'Practice | J&C Asphalt Paving';

const LEADS = [
  ['Ava Mitchell', 'ava.mitchell@example.com', '+18015550101', '4127 Juniper Way, Orem, UT 84057', 'Orem', 'Driveway resurfacing', 'meta', 'open', 96, 585000],
  ['Miles Carter', 'miles.carter@example.com', '+18015550102', '688 Willow Bend, Provo, UT 84604', 'Provo', 'Parking lot striping', 'web_form', 'open', 88, 320000],
  ['Nora Bennett', 'nora.bennett@example.com', '+18015550103', '91 Canyon Crest Dr, Lehi, UT 84043', 'Lehi', 'Sealcoating', 'google', 'booked', 84, 275000],
  ['Theo Sullivan', 'theo.sullivan@example.com', '+18015550104', '1538 Maple Ridge Ln, Springville, UT 84663', 'Springville', 'Driveway paving', 'referral', 'booked', 79, 640000],
  ['Ivy Reynolds', 'ivy.reynolds@example.com', '+18015550105', '2278 Redbud Ave, Orem, UT 84058', 'Orem', 'Asphalt repair', 'meta', 'quoted', 74, 410000],
  ['Caleb Foster', 'caleb.foster@example.com', '+18015550106', '404 Lakeview St, Provo, UT 84601', 'Provo', 'Commercial sealcoat', 'web_form', 'quoted', 68, 185000],
  ['Maya Ellis', 'maya.ellis@example.com', '+18015550107', '739 Alpine Meadow Rd, Lehi, UT 84043', 'Lehi', 'Driveway resurfacing', 'google', 'serviced', 91, 520000],
  ['Owen Parker', 'owen.parker@example.com', '+18015550108', '1820 Orchard Hill Dr, Springville, UT 84663', 'Springville', 'Parking lot paving', 'referral', 'serviced', 86, 1180000],
  ['Lena Walsh', 'lena.walsh@example.com', '+18015550109', '56 Cottonwood Ct, Orem, UT 84057', 'Orem', 'Crack repair', 'meta', 'serviced', 81, 245000],
  ['Grant Sawyer', 'grant.sawyer@example.com', '+18015550110', '267 Aspen Hollow, Provo, UT 84606', 'Provo', 'Driveway paving', 'web_form', 'open', 63, 460000],
  ['Piper Hayes', 'piper.hayes@example.com', '+18015550111', '1209 Foxglove St, Lehi, UT 84045', 'Lehi', 'Sealcoating', 'google', 'quoted', 57, 230000],
  ['Eli Morgan', 'eli.morgan@example.com', '+18015550112', '322 Birch Grove, Springville, UT 84663', 'Springville', 'Asphalt repair', 'referral', 'open', 49, 155000],
  ['Sloane Hart', 'sloane.hart@example.com', '+18015550113', '8470 Sagebrush Way, Orem, UT 84097', 'Orem', 'Parking lot striping', 'meta', 'serviced', 77, 730000],
  ['Finn Dalton', 'finn.dalton@example.com', '+18015550114', '215 Cedar View Ave, Provo, UT 84604', 'Provo', 'Driveway resurfacing', 'web_form', 'quoted', 44, 295000],
];

const iso = (asOf, daysAgo) => new Date(new Date(asOf).getTime() - daysAgo * 86400000).toISOString();

export function buildPracticeLeads(asOf) {
  return LEADS.map(([name, email, phone, address, city, service, source, status, score, quote], i) => {
    const outcome = i === 4 || i === 5 || i === 10 || i === 13 ? 'lost' : i === 6 || i === 7 || i === 8 || i === 12 ? 'won' : null;
    return {
      session_id: PRACTICE_SESSION_ID,
      name, email, phone, address, city, service, source, status, score,
      referrer_name: source === 'referral' ? 'Practice Referral Partner' : null,
      quote_cents: quote,
      contacted: i !== 9 && i !== 11,
      after_hours: i % 4 === 0,
      first_reply_seconds: 12 + i * 4,
      handler: i % 3 === 0 ? 'human' : 'agent',
      created_at: iso(asOf, 3 + i * 4),
      status_updated_at: status === 'open' ? null : iso(asOf, 1 + i),
      is_test: false,
      job_outcome: outcome,
      job_value_cents: outcome === 'won' ? quote : null,
      lost_reason: outcome === 'lost' ? ['budget was delayed', 'chose another bid', 'project postponed', 'timing changed'][i % 4] : null,
    };
  });
}

export function buildPracticeMessages(leads, asOf) {
  const turns = [
    ['Hi, I need my driveway resurfaced this month.', '[Practice fake sent to lead] Thanks for reaching out. What day works for an estimate?'],
    ['We are hoping for next Thursday. The lot is about 900 square feet.', '[Practice fake sent to lead] Great, I noted the size. Would morning or afternoon be better?'],
    ['Morning would be perfect. Can you send the estimate details?', '[Practice fake sent to lead] Absolutely. Your estimate is ready for review.'],
    ['We went with a different bid, but thank you for the quick reply.', null],
    ['Can you patch two cracks near the garage?', '[Practice fake sent to lead] Yes, we can help with that. I can note the repair for the crew.'],
    ['The payment is ready after the job is finished.', '[Practice fake sent to lead] Thanks. We will confirm the final amount after the work.'],
  ];
  return leads.slice(0, turns.length).flatMap((lead, i) => {
    const [inbound, outbound] = turns[i];
    const base = iso(asOf, 2 + i);
    const messages = [{
      lead_id: lead.id,
      session_id: PRACTICE_SESSION_ID,
      direction: 'inbound', author: 'lead', channel: 'sms', body: inbound,
      created_at: base,
    }];
    if (outbound) messages.push({
      lead_id: lead.id,
      session_id: PRACTICE_SESSION_ID,
      direction: 'outbound', author: 'agent', channel: 'sms', body: outbound,
      created_at: iso(asOf, 1 + i),
    });
    if (i === 0 || i === 2) messages.push({
      lead_id: lead.id,
      session_id: PRACTICE_SESSION_ID,
      direction: 'inbound', author: 'lead', channel: 'sms',
      body: i === 0 ? 'Thursday afternoon works.' : 'I got it, thanks.',
      created_at: iso(asOf, i),
    });
    return messages;
  });
}

export function buildPracticePayments(leads, insertedLeads, asOf) {
  const byPhone = new Map(insertedLeads.map(row => [row.phone, row]));
  return leads
    .filter(lead => lead.job_outcome === 'won')
    .flatMap((lead, i) => {
      const row = byPhone.get(lead.phone);
      if (!row) throw new Error(`missing inserted lead for ${lead.phone}`);
      const first = Math.round(lead.job_value_cents * 0.6);
      return [
        { lead_id: row.id, session_id: PRACTICE_SESSION_ID, amount_cents: first, paid_at: iso(asOf, 2 + i), recorded_by: null },
        { lead_id: row.id, session_id: PRACTICE_SESSION_ID, amount_cents: lead.job_value_cents - first, paid_at: iso(asOf, i), recorded_by: null },
      ];
    });
}

export function buildPracticeZoneRows(asOf) {
  const names = LEADS.map(row => row[0]);
  return {
    events: Array.from({ length: 12 }, (_, i) => ({
      session_id: PRACTICE_SESSION_ID,
      agent: i % 3 === 0 ? 'first_responder' : i % 3 === 1 ? 'cultivator' : 'reputation',
      kind: i % 3 === 0 ? 'reply' : i % 3 === 1 ? 'won' : 'review',
      message: i % 3 === 0 ? `Texted ${names[i % names.length]} back` : i % 3 === 1 ? `Estimate for ${names[i % names.length]} came back a win` : `New practice review from ${names[i % names.length]}`,
      created_at: iso(asOf, i),
      source_key: `practice:event:${i}`,
    })),
    appointments: Array.from({ length: 8 }, (_, i) => ({
      session_id: PRACTICE_SESSION_ID,
      customer_name: names[i],
      service: LEADS[i][5],
      price_cents: LEADS[i][9],
      starts_at: iso(asOf, -2 - i),
    })),
    reactivation: {
      session_id: PRACTICE_SESSION_ID, pool_size: 38, contacted: 22, replied: 9, rebooked: 4,
      recovered_cents: 186000, dormancy_3_6mo: 12, dormancy_6_12mo: 14,
      dormancy_1_2yr: 8, dormancy_2yr_plus: 4,
    },
    reactivationWins: [
      { session_id: PRACTICE_SESSION_ID, customer_name: 'Riley Stone', dormant_months: 8, won_cents: 42000, state: 'won' },
      { session_id: PRACTICE_SESSION_ID, customer_name: 'Jordan Blake', dormant_months: 14, won_cents: 31000, state: 'won' },
    ],
    reputation: {
      session_id: PRACTICE_SESSION_ID, jobs_done: 16, rate_asks: 14, rated_45: 11, on_google: 8,
      refer_asks: 9, referrals_in: 4, referrals_closed: 2, referrals_lost: 1,
      referral_revenue_cents: 149000, avg_rating: 4.8,
    },
    reviews: Array.from({ length: 10 }, (_, i) => ({
      session_id: PRACTICE_SESSION_ID, rating: i < 8 ? 5 : 4, author: names[i], created_at: iso(asOf, i * 3),
    })),
    ads: [
      { session_id: PRACTICE_SESSION_ID, platform: 'meta', campaign_id: 'practice-meta-1', campaign_name: 'Practice Driveway Leads', spend_cents: 210000, impressions: 8400, clicks: 268, leads: 7, cpl_cents: 30000, date_pulled: asOf.slice(0, 10), raw: {} },
      { session_id: PRACTICE_SESSION_ID, platform: 'google', campaign_id: 'practice-google-1', campaign_name: 'Practice Local Search', spend_cents: 145000, impressions: 5100, clicks: 191, leads: 5, cpl_cents: 29000, date_pulled: asOf.slice(0, 10), raw: {} },
    ],
    qbMetrics: {
      session_id: PRACTICE_SESSION_ID, period: asOf.slice(0, 7), period_start: `${asOf.slice(0, 7)}-01`, period_end: asOf.slice(0, 10),
      revenue_cents: 2670000, expenses_cents: 1190000, ar_cents: 430000, invoices_outstanding: 2,
      collected_cents: 2180000, date_pulled: asOf.slice(0, 10), raw: {},
    },
  };
}
