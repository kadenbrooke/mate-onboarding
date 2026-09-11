import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { canUseLeadSnapshot } from '@/lib/leads/capability';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';
import { planConfirm, verdictMessage, type ConfirmRow, type RowVerdict } from '@/lib/leads/confirmPlan';
import { snapshotOpening } from '@/lib/leads/snapshotOpening';
import { toE164 } from '@/lib/leads/phone';
import { loadKnownNumbers, ownNumbers } from '@/lib/leads/knownNumbers';
import { nextSendWindowStart, DEFAULT_OUTREACH_HOURS } from '@/lib/agent/quietHours';
import { emitClientEvent } from '@/lib/agent/clientEvents';
import { describeLead } from '@/lib/metrics/eventSources';

// POST /api/dash/<sessionId>/snapshot/<id>/confirm
//
// The send step of Lead Snapshot. This is the only place a photographed
// number becomes a text message, and it happens strictly behind:
//
//   1. the dash gate (member of this session),
//   2. the capability gate (lead_snapshot is live for this client),
//   3. a snapshot that is `ready` and belongs to this session,
//   4. the consent attestation, stored with who and when, and
//   5. the dedupe plan, so a known number is never texted twice from a photo.
//
// The actual send goes through the lead-intake n8n workflow, one call per
// lead, which duplicates the Meta ingest tail: ingest API, seed the
// conversation row, send now or hold with send_after. Quiet hours are decided
// HERE (nextSendWindowStart), and the workflow just does what the payload says.
//
// Spec: amos repo, projects/deployed/mate-onboarding/lead-snapshot-spec.md

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ sessionId: string; id: string }> };

type IntakeReply =
  | { status: 'sent' | 'queued'; send_after?: string | null }
  | { status: 'failed'; error?: string };

export type ConfirmOutcome = {
  index: number;
  outcome: 'sent' | 'queued' | 'duplicate' | 'skipped' | 'invalid' | 'failed';
  message: string;
  /** Set on sent/queued so the result screen can link into the thread. */
  lead_id?: string | null;
  send_after?: string | null;
};

function isRow(v: unknown): v is ConfirmRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  const str = (x: unknown) => x === null || x === undefined || typeof x === 'string';
  return (
    typeof r.index === 'number' &&
    typeof r.include === 'boolean' &&
    str(r.name) && str(r.phone) && str(r.address) && str(r.service) && str(r.notes)
  );
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { sessionId: raw, id: snapshotId } = await params;
  const sessionId = resolveSessionId(raw);

  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const service = createServiceClient();

  const { data: session } = await service
    .from('onboarding_sessions')
    .select('id, is_demo, contact_id, operator_phone')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (session.is_demo) {
    return NextResponse.json({ error: 'Lead Snapshot is not available on the demo dashboard.' }, { status: 400 });
  }
  if (!session.contact_id) {
    return NextResponse.json({ error: 'Lead Snapshot is not enabled for this account.' }, { status: 403 });
  }
  const { data: caps } = await service
    .from('client_capabilities')
    .select('capability_key, status')
    .eq('contact_id', session.contact_id as string);
  if (!canUseLeadSnapshot(caps, verdict.access)) {
    return NextResponse.json({ error: 'Lead Snapshot is not enabled for this account.' }, { status: 403 });
  }

  const tenant = intakeTenantFor(sessionId);
  if (!tenant) {
    // Capability says live but nobody wired the SMS side. Loud, not silent.
    return NextResponse.json({ error: 'Texting is not set up for this account yet.' }, { status: 503 });
  }

  const webhookUrl = process.env.LEAD_INTAKE_WEBHOOK_URL;
  const secret = process.env.LEAD_INTAKE_SECRET;
  if (!webhookUrl || !secret) {
    return NextResponse.json({ error: 'Texting is not configured on the server.' }, { status: 503 });
  }

  // ---- the snapshot ----------------------------------------------------------

  const { data: snapshot } = await service
    .from('lead_snapshots')
    .select('id, status, extracted')
    .eq('id', snapshotId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!snapshot) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (snapshot.status === 'confirmed') {
    // Idempotent: a double tap on Send must not text anyone twice.
    return NextResponse.json({ error: 'This photo was already sent.' }, { status: 409 });
  }
  if (snapshot.status !== 'ready') {
    return NextResponse.json({ error: `This photo is ${snapshot.status}, not ready to send.` }, { status: 409 });
  }

  // ---- the body ----------------------------------------------------------------

  let body: { rows?: unknown; consent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json(
      { error: 'Please confirm these people asked to be contacted before sending.' },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0 || !body.rows.every(isRow)) {
    return NextResponse.json({ error: 'rows[] required' }, { status: 400 });
  }
  const rows = body.rows as ConfirmRow[];
  if (rows.length > 50) return NextResponse.json({ error: 'Too many rows.' }, { status: 400 });

  // ---- what we already know --------------------------------------------------

  const candidateE164 = rows
    .filter(r => r.include)
    .map(r => toE164(r.phone))
    .flatMap(p => (p.ok ? [p.e164] : []));

  const known = await loadKnownNumbers(service, sessionId, tenant, candidateE164);
  const blocked = ownNumbers(tenant, session.operator_phone as string | null);

  const now = new Date();
  const plan = planConfirm(rows, known, now, blocked);

  // ---- who is attesting --------------------------------------------------------

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Claim BEFORE sending. If two taps race, the second sees `confirmed` above.
  // A missed lead is recoverable; a duplicate text to a real person is not.
  const { data: claimed } = await service
    .from('lead_snapshots')
    .update({
      status: 'confirmed',
      confirmed_at: now.toISOString(),
      uploaded_by: user?.id ?? null,
      confirmed: {
        rows,
        consent: { attested: true, user_id: user?.id ?? null, email: user?.email ?? null, at: now.toISOString() },
        plan: plan.map(v => ({ index: v.index, kind: v.kind, ...('reason' in v ? { reason: v.reason } : {}) })),
        results: null,
      },
    })
    .eq('id', snapshotId)
    .eq('status', 'ready')
    .select('id')
    .maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'This photo was already sent.' }, { status: 409 });

  // ---- send ------------------------------------------------------------------------

  const sendAfter = nextSendWindowStart(DEFAULT_OUTREACH_HOURS, now);
  const hold = sendAfter.getTime() > now.getTime();

  const outcomes: ConfirmOutcome[] = [];
  for (const v of plan) {
    if (v.kind !== 'send') {
      outcomes.push({ index: v.index, outcome: v.kind, message: verdictMessage(v) });
      continue;
    }
    const outcome = await sendOne(v, {
      sessionId, snapshotId, tenant, webhookUrl, secret, hold, sendAfter,
    });
    outcomes.push(outcome);
  }

  // ---- link outcomes to lead rows, mirror to the ticker ----------------------------

  const sentKeys = plan.filter(v => v.kind === 'send').map(v => (v as Extract<RowVerdict, { kind: 'send' }>).e164);
  if (sentKeys.length > 0) {
    const { data: created } = await service
      .from('client_leads')
      .select('id, phone, name')
      .eq('session_id', sessionId)
      .in('phone', sentKeys);
    const byPhone = new Map((created ?? []).map(l => [String(l.phone), l]));
    for (const v of plan) {
      if (v.kind !== 'send') continue;
      const o = outcomes.find(x => x.index === v.index);
      const lead = byPhone.get(v.e164);
      if (o && lead) o.lead_id = lead.id as string;
      if (o && (o.outcome === 'sent' || o.outcome === 'queued')) {
        await emitClientEvent(service, {
          session_id: sessionId,
          agent: 'first_responder',
          kind: 'reply',
          message: o.outcome === 'sent'
            ? `Texted ${describeLead(v.lead.name, v.e164)} from a photo`
            : `Queued a text to ${describeLead(v.lead.name, v.e164)} from a photo`,
          created_at: now.toISOString(),
          source_key: `snapshot:${snapshotId}:${v.leadKey}`,
          lead_key: v.leadKey,
        });
      }
    }
  }

  await service
    .from('lead_snapshots')
    .update({ confirmed: { ...(claimedConfirmed(rows, plan, user, now)), results: outcomes } })
    .eq('id', snapshotId);

  return NextResponse.json({ snapshot_id: snapshotId, hold, send_after: hold ? sendAfter.toISOString() : null, outcomes });
}

function claimedConfirmed(rows: ConfirmRow[], plan: RowVerdict[], user: { id: string; email?: string } | null, now: Date) {
  return {
    rows,
    consent: { attested: true, user_id: user?.id ?? null, email: user?.email ?? null, at: now.toISOString() },
    plan: plan.map(v => ({ index: v.index, kind: v.kind, ...('reason' in v ? { reason: v.reason } : {}) })),
  };
}

async function sendOne(
  v: Extract<RowVerdict, { kind: 'send' }>,
  ctx: {
    sessionId: string; snapshotId: string;
    tenant: NonNullable<ReturnType<typeof intakeTenantFor>>;
    webhookUrl: string; secret: string; hold: boolean; sendAfter: Date;
  },
): Promise<ConfirmOutcome> {
  const opening = snapshotOpening(ctx.tenant, { name: v.lead.name, service: v.lead.service });
  const payload = {
    session_id: ctx.sessionId,
    source: 'lead_snapshot',
    snapshot_id: ctx.snapshotId,
    // Idempotency key the workflow can use if it ever grows a ledger.
    intake_key: `${ctx.snapshotId}:${v.leadKey}`,
    lead: { ...v.lead, source: 'lead_snapshot', created_at: new Date().toISOString() },
    tenant: {
      contact_id: ctx.tenant.contactId,
      sms_from: ctx.tenant.smsFrom,
      messaging_profile_id: ctx.tenant.messagingProfileId,
      conversation_table: ctx.tenant.conversationTable,
    },
    opening,
    hold: ctx.hold,
    send_after: ctx.hold ? ctx.sendAfter.toISOString() : null,
  };

  try {
    const res = await fetch(ctx.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': ctx.secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let reply: IntakeReply | null = null;
    try { reply = JSON.parse(text) as IntakeReply; } catch { reply = null; }

    if (!res.ok || !reply || reply.status === 'failed') {
      const detail = reply && 'error' in reply && reply.error ? reply.error : `${res.status}`;
      console.error('lead-intake failed', ctx.snapshotId, v.leadKey, detail);
      return { index: v.index, outcome: 'failed', message: 'Could not send. Nothing was texted.' };
    }
    if (reply.status === 'queued') {
      return {
        index: v.index, outcome: 'queued',
        message: `Queued. Goes out at ${formatWhen(ctx.sendAfter)}.`,
        send_after: ctx.sendAfter.toISOString(),
      };
    }
    return { index: v.index, outcome: 'sent', message: 'Text sent.' };
  } catch (err) {
    console.error('lead-intake threw', ctx.snapshotId, v.leadKey, err instanceof Error ? err.message : err);
    return { index: v.index, outcome: 'failed', message: 'Could not reach the sender. Nothing was texted.' };
  }
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_OUTREACH_HOURS.tz, weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(d);
}
