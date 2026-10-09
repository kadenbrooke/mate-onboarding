import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import {
  fetchMetaSpend30dCents, fetchRevenueBySource, summarizeReturn, type AdSpendQuery, type RevenueQuery,
} from '@/lib/metrics/revenue';
import {
  fetchOpenBook, fetchWonLeads, fetchLastOutbound, fetchPaidByLead, type CommandDb,
} from '@/lib/command/fetch';
import { buildCommandModel, outboundCandidates, type LeadSignal } from '@/lib/command/commandCenter';
import { leadLabel } from '@/components/dash/leads/leadName';
import { CommandCenter } from '@/components/dash/command/CommandCenter';
import { MobileNav } from '@/components/dash/MobileNav';
import { canViewCommandCenter } from '@/lib/portal/dash-access';

// The owner's Command Center (Auto Mate 5 #5): who to call, what is waiting,
// what is on the books, what is stuck. Same gate as every /dash page (login +
// same tenant, or the public read-only demo). Read-only: every action on the
// screen is a link (a tel: call, or the lead's thread in the pipeline).
//
// No "newest N leads" slice: every open lead and every won lead is read in
// full (eligibility filtered in SQL, paged to exhaustion; lib/command/fetch.ts),
// so no card drops a row it claims to show. A scan that ever hits its page
// ceiling is flagged and the card says so.
//
// The cast-through-unknown on each query mirrors /dash: the service client's
// generics are far deeper than the small structural contracts need.

export default async function CommandPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);
  const access = await requireDashAccess(sessionId);
  if (!canViewCommandCenter(access)) notFound();
  const supabase = createServiceClient();
  const db = supabase as unknown as CommandDb;

  const { data: session } = await supabase.from('onboarding_sessions').select('id').eq('id', sessionId).single();
  if (!session) notFound();

  const now = new Date();
  const [open, won, revenueRows, metaSpend] = await Promise.all([
    fetchOpenBook(db, sessionId),
    fetchWonLeads(db, sessionId),
    fetchRevenueBySource(supabase as unknown as RevenueQuery, sessionId),
    fetchMetaSpend30dCents(supabase as unknown as AdSpendQuery, sessionId),
  ]);
  const openLeads = open?.leads ?? [];
  const signals = open?.signals ?? new Map<string, LeadSignal>();

  // Outbound times only for open, human-handled leads that have texted in,
  // and only after the earliest such text; payments only for won leads.
  const outbound = outboundCandidates(openLeads, signals);
  const [lastOutbound, paidByLead] = await Promise.all([
    outbound.since ? fetchLastOutbound(db, sessionId, outbound.ids, outbound.since) : Promise.resolve(new Map<string, string>()),
    won ? fetchPaidByLead(db, sessionId, won.leads.map(l => l.id)) : Promise.resolve(null),
  ]);

  const model = buildCommandModel({
    sessionId,
    openLeads,
    wonLeads: won?.leads ?? [],
    signals,
    // A failed open-lead read is not "nothing open": flag the cards instead.
    // Any failed or capped read counts as incomplete, never as empty.
    complete: { open: open?.complete ?? false, won: won?.complete ?? false, paid: paidByLead != null },
    lastOutbound,
    paidByLead,
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
