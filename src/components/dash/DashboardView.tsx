import type { Lead } from '@/lib/metrics/leads';

export function DashboardView({
  session,
  leads,
}: {
  session: { id: string; mate_name?: string | null };
  leads: Lead[];
}) {
  return <main>{leads.length} leads</main>;
}
