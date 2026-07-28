import type { ReactNode } from 'react';
import { createServiceClient } from '@/lib/supabase/service';
import { brandToCssVars, FONT_BODY } from '@/lib/theme';
import type { Brand } from '@/lib/research/website';

interface DashLayoutProps {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}

export default async function DashLayout({ children, params }: DashLayoutProps) {
  const { sessionId } = await params;

  // Fetch session brand + client identity. Fail-open: missing data falls
  // back to Auto Mate default colors, and no logo is shown in the topbar.
  let brand: Brand | null = null;
  let businessName: string | null = null;
  let logoUrl: string | null = null;
  try {
    const supabase = createServiceClient();
    const { data: session } = await supabase
      .from('onboarding_sessions')
      .select('brand, collected')
      .eq('id', sessionId)
      .maybeSingle();
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
        minHeight: '100vh',
        background: 'var(--mate-bg, #141414)',
        color: 'var(--mate-accent, #ede6e6)',
        ...cssVars,
      }}
    >
      {/* Client identity topbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid #222',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        {logoUrl && (
          <img
            src={logoUrl}
            alt={businessName ?? 'Client logo'}
            height={30}
            style={{ width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }}
          />
        )}
        {businessName && (
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT_BODY,
              fontWeight: 600,
              color: 'var(--mate-accent, #ede6e6)',
              letterSpacing: '-0.01em',
            }}
          >
            {businessName}
          </span>
        )}
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 90px' }}>
        {children}
      </div>
    </div>
  );
}
