import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import type { Lead } from '@/lib/metrics/leads';
import type { DashCapability } from '@/components/dash/types';
import { DashboardView } from '@/components/dash/DashboardView';
import type { DashData } from '@/components/dash/types';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { adTotals, type AdMetricRow } from '@/lib/metrics/ads';

export default async function DashPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  // "demo" alias -> real demo UUID for all DB reads below (uuid column).
  const sessionId = resolveSessionId(rawSessionId);
  await requireDashAccess(sessionId);
  const supabase = createServiceClient();

  // Load session - also fetch contact_id so we can join client_capabilities
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, mate_name, contact_id')
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
    adMetricsResult,
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
    // Ad Performance zone: latest daily snapshot per platform (Meta + Google
    // share this one card). Ordered date desc so the newest rows come first.
    supabase
      .from('ad_metrics')
      .select('session_id, platform, campaign_id, campaign_name, spend_cents, impressions, clicks, leads, cpl_cents, date_pulled, raw')
      .eq('session_id', sessionId)
      .order('date_pulled', { ascending: false })
      .limit(100),
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

  // Map client_capabilities rows: capability_key -> key
  const rawCaps = capabilitiesResult.data ?? [];
  const capabilities: DashCapability[] = rawCaps.map((row) => ({
    key: String(row.capability_key),
    label: String(row.label),
    status: String(row.status),
  }));

  const data: DashData = {
    events: eventsResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
    reactivation: reactivationResult.data ?? null,
    wins: winsResult.data ?? [],
    reputation: reputationResult.data ?? null,
    reviews: reviewsResult.data ?? [],
    capabilities,
    incidents: incidentsResult.data ?? [],
    weekActionCount: weekActionCountResult.count ?? 0,
    ads,
  };

  return (
    <DashboardView
      session={{ id: session.id, mate_name: session.mate_name }}
      leads={(leadsResult.data ?? []) as Lead[]}
      data={data}
    />
  );
}
