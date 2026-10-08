import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import {
  fetchMetaSpend30dCents, fetchRevenueBySource, summarizeReturn, type AdSpendQuery, type RevenueQuery,
} from '@/lib/metrics/revenue';
import {
  fetchCallNow, fetchWaitingCandidates, fetchStuckCandidates, fetchLastOutbound, fetchPaidByLead,
  type CommandDb,
} from '@/lib/command/fetch';
import { buildCommandModel, isClosed, type LeadSignal } from '@/lib/command/commandCenter';
import { leadLabel } from '@/components/dash/leads/leadName';
import { CommandCenter } from '@/components/dash/command/CommandCenter';
import { MobileNav } from '@/components/dash/MobileNav';

// The owner's Command Center (Auto Mate 5 #5): who to call, what is waiting,
// what is on the books, what is stuck. Same gate as every /dash page (login +
// same tenant, or the public read-only demo). Read-only: every action on the
// screen is a link (a tel: call, or the lead's thread in the pipeline).
//
// No "newest N leads" slice: each card runs its own tenant-scoped query for
// exactly the leads it needs (lib/command/fetch.ts), so an older lead is never
// missing from a list it belongs on.
//
// The cast-through-unknown on each query mirrors /dash: the service client's
// generics are far deeper than the small structural contracts need.

export default async function CommandPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);
  const access = await requireDashAccess(sessionId);
  const supabase = createServiceClient();
  const db = supabase as unknown as CommandDb;

  const { data: session } = await supabase.from('onboarding_sessions').select('id').eq('id', sessionId).single();
  if (!session) notFound();

  const now = new Date();
  const [callNow, waitingCandidates, stuckCandidates, revenueRows, metaSpend] = await Promise.all([
    fetchCallNow(db, sessionId),
    fetchWaitingCandidates(db, sessionId, now),
    fetchStuckCandidates(db, sessionId, now),
    fetchRevenueBySource(supabase as unknown as RevenueQuery, sessionId),
    fetchMetaSpend30dCents(supabase as unknown as AdSpendQuery, sessionId),
  ]);

  const signals = new Map<string, LeadSignal>(waitingCandidates.signals);
  if (callNow.status === 'live') for (const [id, s] of callNow.signals) signals.set(id, s);

  // Outbound times only matter for open, human-handled leads that have texted
  // in; payments only for won leads.
  const repliedHuman = waitingCandidates.leads
    .filter(l => !isClosed(l) && l.handler === 'human' && signals.get(l.id)?.last_lead_reply_at)
    .map(l => l.id);
  const won = stuckCandidates.won;
  const [lastOutbound, paid] = await Promise.all([
    fetchLastOutbound(db, sessionId, repliedHuman),
    won ? fetchPaidByLead(db, sessionId, won.map(l => l.id)) : Promise.resolve(null),
  ]);

  const model = buildCommandModel({
    sessionId,
    callLeads: callNow.status === 'live' ? callNow.leads : [],
    // A failed ranking read says "not scored" rather than "nobody to call".
    scored: callNow.status === 'live' && callNow.scored,
    waitLeads: waitingCandidates.leads,
    stuckLeads: [...(won ?? []), ...(stuckCandidates.staleQuotes ?? [])],
    signals,
    lastOutbound,
    paidByLead: won ? paid : null,
    summary: revenueRows ? summarizeReturn(revenueRows, { metaSpend30dCents: metaSpend }) : null,
    now,
    label: leadLabel,
  });
  // The owner's day, in the owner's time zone (every Mate client today is in Utah).
  const today = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Denver',
  });

  return (
    <div>
      <CommandCenter model={model} today={today} demo={access === 'demo'} />
      <MobileNav sessionId={sessionId} />
    </div>
  );
}
