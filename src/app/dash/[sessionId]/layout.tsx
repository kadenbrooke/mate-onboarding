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
        // Kill stray horizontal overflow (wide SVGs, popovers at row edges)
        // without creating a scroll container: clip-x keeps overflow-y visible.
        overflowX: 'clip',
        ...cssVars,
      }}
    >
      <style>{`
        /* Bottom clearance = fixed MobileNav height + iPhone home indicator.
           Class-based so env() survives (CSSOM drops it from inline styles in
           some engines). */
        .dash-shell { padding: 4px 16px calc(90px + env(safe-area-inset-bottom, 0px)); }
        /* Icon rail is desktop chrome; below 641px the bottom MobileNav owns nav. */
        @media (max-width: 640px) { .dash-rail { display: none !important; } }
        /* Mid widths: shift content right so the fixed rail never overlaps it.
           !important because the base padding is set inline. */
        @media (min-width: 641px) and (max-width: 1260px) { .dash-shell { padding-left: 70px !important; } }
        /* Touch-target slop: extends the effective hit area of small controls
           (range chips, ring legend buttons, calendar dots) without changing
           their visual size. */
        .dash-tap { position: relative; }
        .dash-tap::after { content: ''; position: absolute; inset: -8px; }
        /* Vertical-only slop for tightly packed siblings (calendar dots sit
           12px apart center-to-center; full slop would cover the neighbor). */
        .dash-tap-y { position: relative; }
        .dash-tap-y::after { content: ''; position: absolute; inset: -8px -1px; }
      `}</style>

      <TopBar
        sessionId={sessionId}
        businessName={businessName}
        logoUrl={logoUrl}
        openIncidents={openIncidents}
      />
      <IconRail />

      <div className="dash-shell" style={{ maxWidth: 1100, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}
