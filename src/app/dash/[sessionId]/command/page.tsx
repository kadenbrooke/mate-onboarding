import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import type { Lead } from '@/lib/metrics/leads';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { mergeLiveScores } from '@/lib/leads/liveScores';
import {
  fetchMetaSpend30dCents, fetchRevenueBySource, summarizeReturn, type AdSpendQuery, type RevenueQuery,
} from '@/lib/metrics/revenue';
import {
  fetchLeadSignals, fetchLastOutbound, fetchPaidByLead, toLiveScores,
  type SignalQuery, type OutboundQuery, type PaymentQuery,
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
// The cast-through-unknown on each query mirrors /dash: the service client's
// generics are far deeper than the small structural contracts need.

export default async function CommandPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);
  const access = await requireDashAccess(sessionId);
  const supabase = createServiceClient();

  const { data: session } = await supabase.from('onboarding_sessions').select('id').eq('id', sessionId).single();
  if (!session) notFound();

  // Same lead read as /dash and the pipeline: newest 500, test phones out.
  const { data: leadRows } = await supabase.from('client_leads')
    .select('*').eq('session_id', sessionId)
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(500);
  const loaded = (leadRows ?? []) as Lead[];
  const ids = loaded.map(l => l.id);

  const [signalsResult, revenueRows, metaSpend] = await Promise.all([
    fetchLeadSignals(supabase as unknown as SignalQuery, sessionId, ids),
    fetchRevenueBySource(supabase as unknown as RevenueQuery, sessionId),
    fetchMetaSpend30dCents(supabase as unknown as AdSpendQuery, sessionId),
  ]);
  const signals = signalsResult.status === 'live' ? signalsResult.signals : new Map<string, LeadSignal>();
  const leads = mergeLiveScores(loaded, toLiveScores(signalsResult));

  // Outbound times only matter for open, human-handled leads that have texted
  // in; payments only for leads marked won. Both reads stay that small.
  const repliedHuman = leads
    .filter(l => !isClosed(l) && l.handler === 'human' && signals.get(l.id)?.last_lead_reply_at)
    .map(l => l.id);
  const wonIds = leads.filter(l => l.job_outcome === 'won').map(l => l.id);
  const [lastOutbound, paidByLead] = await Promise.all([
    fetchLastOutbound(supabase as unknown as OutboundQuery, sessionId, repliedHuman),
    fetchPaidByLead(supabase as unknown as PaymentQuery, sessionId, wonIds),
  ]);

  const now = new Date();
  const model = buildCommandModel({
    sessionId,
    leads,
    signals,
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
