import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

const LEAD_FIELDS = [
  'name', 'phone', 'city', 'service', 'source', 'referrer_name', 'score', 'status',
  'quote_cents', 'contacted', 'after_hours', 'first_reply_seconds', 'created_at',
  'email', 'address',
] as const;

// Fields a REPEAT submission from the same phone is allowed to fill in.
//
// A returning lead's Meta payload is almost always sparser than what we already
// know: the form gives name/phone/city, while address, dimensions and quote were
// learned during the earlier conversation. So a re-ingest fills blanks and never
// overwrites a value we already hold.
//
// Deliberately NOT here, and therefore never touched by a re-ingest:
//   source, created_at            -- first-touch attribution survives
//   status, contacted, after_hours,
//   first_reply_seconds           -- conversation lifecycle survives
//   handler, capi_*, *_updated_at -- owned by other systems entirely
const MERGE_FILLABLE = [
  'name', 'city', 'service', 'referrer_name', 'score', 'quote_cents', 'email', 'address',
] as const;

const UNIQUE_VIOLATION = '23505';

type LeadRow = Record<string, unknown>;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function tokenValid(token: string | null): boolean {
  const expected = process.env.LEADS_INGEST_TOKEN ?? '';
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!tokenValid(request.headers.get('x-ingest-token'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { session_id?: string; leads?: Record<string, unknown>[]; allow_demo?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (!body.session_id || !Array.isArray(body.leads)) {
    return NextResponse.json({ error: 'session_id and leads[] required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const sessionId = body.session_id;

  // An is_demo session renders without authentication, so anything written here
  // is world-readable to anyone holding the URL. A caller-supplied session_id
  // once pointed a real client's Meta lead backfill at the public demo, putting
  // ~83 real names and phone numbers on an unauthed page for three months.
  // Seeding the demo is legitimate, but it has to be stated outright.
  const { data: target, error: lookupError } = await supabase
    .from('onboarding_sessions')
    .select('is_demo')
    .eq('id', sessionId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: 'unknown session_id' }, { status: 404 });
  }
  if (target.is_demo && body.allow_demo !== true) {
    return NextResponse.json(
      {
        error:
          'refusing to write leads to an is_demo session (publicly readable). ' +
          'Pass allow_demo: true if these are seeded/synthetic leads.',
      },
      { status: 400 },
    );
  }

  const rows: LeadRow[] = body.leads.map((lead) => {
    const row: LeadRow = { session_id: sessionId };
    for (const f of LEAD_FIELDS) {
      if (lead[f] !== undefined) row[f] = lead[f];
    }
    return row;
  });

  // Rows with no phone cannot collide on (session_id, phone): Postgres treats
  // NULLs as distinct in a unique constraint, so they always insert.
  const anonymous = rows.filter((r) => isBlank(r.phone));
  const identified = rows.filter((r) => !isBlank(r.phone));

  let created = 0;
  let updated = 0;

  if (anonymous.length > 0) {
    const { error } = await supabase.from('client_leads').insert(anonymous);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    created += anonymous.length;
  }

  if (identified.length > 0) {
    try {
      const result = await mergeOrInsert(supabase, sessionId, identified);
      created += result.created;
      updated += result.updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // `inserted` stays the total number of rows written so existing callers that
  // gate on `inserted > 0` keep working; created/updated say which happened.
  return NextResponse.json({ inserted: created + updated, created, updated });
}

/**
 * Write leads that carry a phone number, treating (session_id, phone) as the
 * lead's identity: an unseen phone inserts, a known phone merges gap-fills into
 * the row that already exists.
 *
 * `attempt` guards the insert/insert race. Two callers can both read "no such
 * phone" and both try to insert; the loser gets a unique violation. Rather than
 * surfacing that as a 500 (which is exactly the bug this replaces), we re-read
 * and merge, because by then the row provably exists.
 */
async function mergeOrInsert(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  leads: LeadRow[],
  attempt = 0,
): Promise<{ created: number; updated: number }> {
  const phones = [...new Set(leads.map((r) => String(r.phone)))];

  const { data: existing, error: readError } = await supabase
    .from('client_leads')
    .select('*')
    .eq('session_id', sessionId)
    .in('phone', phones);

  if (readError) throw new Error(readError.message);

  const byPhone = new Map<string, LeadRow>(
    (existing ?? []).map((row) => [String((row as LeadRow).phone), row as LeadRow]),
  );

  const toInsert: LeadRow[] = [];
  let updated = 0;

  for (const lead of leads) {
    const prior = byPhone.get(String(lead.phone));
    if (!prior) {
      toInsert.push(lead);
      continue;
    }

    const patch: LeadRow = {};
    for (const field of MERGE_FILLABLE) {
      if (!isBlank(lead[field]) && isBlank(prior[field])) patch[field] = lead[field];
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('client_leads').update(patch).eq('id', prior.id);
      if (error) throw new Error(error.message);
    }
    // A repeat submission that taught us nothing new is still a successful
    // ingest, not a dropped lead — count it either way.
    updated += 1;
  }

  if (toInsert.length === 0) return { created: 0, updated };

  const { error: insertError } = await supabase.from('client_leads').insert(toInsert);

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION && attempt === 0) {
      const retry = await mergeOrInsert(supabase, sessionId, toInsert, attempt + 1);
      return { created: retry.created, updated: updated + retry.updated };
    }
    throw new Error(insertError.message);
  }

  return { created: toInsert.length, updated };
}
