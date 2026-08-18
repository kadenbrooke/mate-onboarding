import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import type { Lead } from '@/lib/metrics/leads';
import { activeAgentCount } from '@/lib/metrics/crew';
import type { DashCapability } from '@/components/dash/types';
import { DashboardView } from '@/components/dash/DashboardView';
import type { DashData } from '@/components/dash/types';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { adTotals, type AdMetricRow } from '@/lib/metrics/ads';
import { fetchMoneyTotals, type MoneyQuery } from '@/lib/metrics/money';
import { zoneLocks } from '@/lib/dash/locks';
import { gateLockedZoneData } from '@/lib/dash/gate';

export default async function DashPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  // "demo" alias -> real demo UUID for all DB reads below (uuid column).
  const sessionId = resolveSessionId(rawSessionId);
  await requireDashAccess(sessionId);
  const supabase = createServiceClient();

  // Load session - also fetch contact_id so we can join client_capabilities
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, mate_name, contact_id, collected, agent_enabled, operator_phone, created_at')
    .eq('id', sessionId)
    .single();
  if (!session) notFound();

  // Leads + all Plan-2 zone data in parallel
  const [
    leadsResult,
    eventsResult,
    appointmentsResult,
    reactivationResult,
    winsResult,
    reputationResult,
    reviewsResult,
    capabilitiesResult,
    incidentsResult,
    weekActionCountResult,
    missedCallCountResult,
    adMetricsResult,
    money,
    contactResult,
  ] = await Promise.all([
    supabase
      .from('client_leads')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('client_events')
      .select('id, agent, kind, message, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('client_appointments')
      .select('id, customer_name, service, price_cents, starts_at')
      .eq('session_id', sessionId)
      .limit(200),
    supabase
      .from('client_reactivation')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabase
      .from('client_reactivation_wins')
      .select('id, customer_name, dormant_months, won_cents, state')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('client_reputation')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabase
      .from('client_reviews')
      .select('id, rating, author, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(200),
    // client_capabilities is anchored on contact_id (migration 016), not session_id.
    // The session row carries contact_id set at onboarding completion.
    // Map DB rows (capability_key, label, status) into Capability { key, label, status }.
    session.contact_id
      ? supabase
          .from('client_capabilities')
          .select('capability_key, label, status')
          .eq('contact_id', session.contact_id as string)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('client_incidents')
      .select('id, severity, message, started_at, resolved_at')
      .eq('session_id', sessionId)
      .is('resolved_at', null)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('client_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    // RescueRing's denominator: how many missed calls this session has EVER
    // recorded. A count query, not a slice of the 50-row events fetch above --
    // that fetch is sized for the Ticker, while the numerator (speedStats'
    // `rescued`) counts across up to 500 leads, so deriving the denominator
    // from it capped the ratio below the numerator and understated the rescue
    // rate. Only the number is needed, so head:true ships no rows.
    supabase
      .from('client_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('kind', 'missed_call'),
    // Ad Performance zone: latest daily snapshot per platform (Meta + Google
    // share this one card). Ordered date desc so the newest rows come first.
    supabase
      .from('ad_metrics')
      .select('session_id, platform, campaign_id, campaign_name, spend_cents, impressions, clicks, leads, cpl_cents, date_pulled, raw')
      .eq('session_id', sessionId)
      .order('date_pulled', { ascending: false })
      .limit(100),
    // Money zone: latest QBO financial snapshot for THIS session. Tenant-scoped
    // read (fetchMoneyTotals filters by session_id and re-checks the returned
    // row's session_id); null when QBO isn't connected, which drives the lock.
    // Cast through unknown: the service client's generics are far deeper than
    // the small MoneyQuery contract needs, and matching them structurally
    // inside this Promise.all tuple trips TS "excessively deep" inference.
    fetchMoneyTotals(supabase as unknown as MoneyQuery, sessionId),
    // The client's monthly retainer, for the hero ROI multiple. Lives on the
    // CRM contact the session was linked to at onboarding completion. NOTE:
    // contacts.monthly_retainer is stored in DOLLARS, unlike every *_cents
    // column in this schema, so it is converted below.
    session.contact_id
      ? supabase
          .from('contacts')
          .select('monthly_retainer')
          .eq('id', session.contact_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Collapse ad_metrics to the latest snapshot PER PLATFORM, then compute zone
  // totals. Resolving one global latest date would silently drop a platform
  // whenever the two refreshes land on different days (independent schedules,
  // and a failed Google pull leaves yesterday's row as its newest).
  const allAdRows = (adMetricsResult.data ?? []) as AdMetricRow[];
  const newestPerPlatform = new Map<string, string>();
  for (const r of allAdRows) {
    const seen = newestPerPlatform.get(r.platform);
    if (!seen || r.date_pulled > seen) newestPerPlatform.set(r.platform, r.date_pulled);
  }
  const latestAdRows = allAdRows.filter((r) => newestPerPlatform.get(r.platform) === r.date_pulled);
  const ads = latestAdRows.length ? adTotals(latestAdRows) : null;

  // Zone lock state, derived from signals already on the session row. `ads` is
  // null when the session has no ad_metrics rows, so it doubles as the ads gate
  // with no extra query.
  const locks = zoneLocks({
    sessionId,
    collected: (session.collected ?? null) as Record<string, unknown> | null,
    agentEnabled: session.agent_enabled === true,
    operatorPhone: (session.operator_phone ?? null) as string | null,
    adsPresent: ads !== null,
    moneyPresent: money !== null,
  });

  // Map client_capabilities rows: capability_key -> key
  const rawCaps = capabilitiesResult.data ?? [];
  const capabilities: DashCapability[] = rawCaps.map((row) => ({
    key: String(row.capability_key),
    label: String(row.label),
    status: String(row.status),
  }));

  const rawData: DashData = {
    events: eventsResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
    reactivation: reactivationResult.data ?? null,
    wins: winsResult.data ?? [],
    reputation: reputationResult.data ?? null,
    reviews: reviewsResult.data ?? [],
    capabilities,
    incidents: incidentsResult.data ?? [],
    weekActionCount: weekActionCountResult.count ?? 0,
    missedCallCount: missedCallCountResult.count ?? 0,
    ads,
    money,
  };

  // Withhold every locked zone's data from the client payload. Card.tsx never
  // MOUNTS locked children, but without this the rows would still ride along in
  // the RSC/Flight payload embedded in the HTML. Locked zone == no data shipped.
  const data = gateLockedZoneData(rawData, locks);

  // Month Overview glance counts, derived from the UNGATED data on purpose.
  // The gate exists to keep a locked zone's ROWS (review authors, capability
  // detail) out of the client payload; these are two integers, which disclose
  // nothing, and reading them post-gate would make a locked Operations zone
  // silently under-report the client's own crew.
  const glance = {
    activeAgents: activeAgentCount(rawData.capabilities),
    // Capped by the reviews query limit (200); fine at current volumes, and a
    // client past 200 reviews needs a count(*) here rather than a longer list.
    reviewsCollected: rawData.reviews.length,
  };

  // Dollars -> cents. A missing contact, a missing retainer, or a non-positive
  // one all resolve to null, which suppresses the ROI multiple entirely: a
  // divide-by-a-guess is worse than no number.
  const rawRetainer = Number(contactResult.data?.monthly_retainer ?? NaN);
  const monthlyRetainerCents = Number.isFinite(rawRetainer) && rawRetainer > 0
    ? Math.round(rawRetainer * 100)
    : null;

  return (
    <DashboardView
      session={{
        id: session.id,
        mate_name: session.mate_name,
        created_at: (session.created_at ?? null) as string | null,
        monthlyRetainerCents,
      }}
      leads={(leadsResult.data ?? []) as Lead[]}
      data={data}
      locks={locks}
      glance={glance}
    />
  );
}
