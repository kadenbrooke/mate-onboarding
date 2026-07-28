import type { ReactNode } from 'react';
import { createServiceClient } from '@/lib/supabase/service';
import { brandToCssVars, BG_PAGE, TEXT_DARK } from '@/lib/theme';
import type { Brand } from '@/lib/research/website';
import { TopBar } from '@/components/dash/chrome/TopBar';
import { IconRail } from '@/components/dash/chrome/IconRail';

interface DashLayoutProps {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}

export default async function DashLayout({ children, params }: DashLayoutProps) {
  const { sessionId } = await params;

  // Fetch session brand + client identity + open incident count. Fail-open:
  // missing data falls back to Auto Mate defaults (black logo, zero badge).
  let brand: Brand | null = null;
  let businessName: string | null = null;
  let logoUrl: string | null = null;
  let openIncidents = 0;
  try {
    const supabase = createServiceClient();
    const [{ data: session }, incidentsResult] = await Promise.all([
      supabase
        .from('onboarding_sessions')
        .select('brand, collected')
        .eq('id', sessionId)
        .maybeSingle(),
      supabase
        .from('client_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .is('resolved_at', null),
    ]);
    if (session?.brand && typeof session.brand === 'object') {
      brand = session.brand as Brand;
      logoUrl = brand.logo_url ?? null;
    }
    if (session?.collected && typeof session.collected === 'object') {
      const collected = session.collected as Record<string, unknown>;
      const company = collected.company;
      if (company && typeof company === 'object') {
        businessName = (company as { name?: string }).name ?? null;
      }
    }
    openIncidents = incidentsResult.count ?? 0;
  } catch {
    // Non-fatal: layout still renders with defaults.
  }

  // Wire session brand into CSS vars so all dash components that reference
  // var(--brand-primary) or var(--mate-*) pick up the client color without
  // any client-side JS. brandToCssVars produces --mate-* vars; we also alias
  // --brand-primary so the brandVar constant in theme.ts resolves correctly.
  const cssVars: React.CSSProperties = brand
    ? ({
        ...brandToCssVars(brand),
        '--brand-primary': brand.colors.primary,
      } as React.CSSProperties)
    : {};

  return (
    <div
      style={{
        // Dash light shell (2026-07 redesign): warm off-white canvas + dark
        // text. Tenant brand vars still cascade for accent colors; the dark
        // --mate-bg shell now belongs only to onboarding/portal/demo.
        minHeight: '100vh',
        background: BG_PAGE,
        color: TEXT_DARK,
        ...cssVars,
      }}
    >
      <style>{`
        /* Icon rail is desktop chrome; below 641px the bottom MobileNav owns nav. */
        @media (max-width: 640px) { .dash-rail { display: none !important; } }
        /* Mid widths: shift content right so the fixed rail never overlaps it.
           !important because the base padding is set inline. */
        @media (min-width: 641px) and (max-width: 1260px) { .dash-shell { padding-left: 70px !important; } }
      `}</style>

      <TopBar
        sessionId={sessionId}
        businessName={businessName}
        logoUrl={logoUrl}
        openIncidents={openIncidents}
      />
      <IconRail />

      <div className="dash-shell" style={{ maxWidth: 1100, margin: '0 auto', padding: '4px 16px 90px' }}>
        {children}
      </div>
    </div>
  );
}
