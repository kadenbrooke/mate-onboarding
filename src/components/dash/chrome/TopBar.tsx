'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SquaresFour, UsersThree, Bell } from '@phosphor-icons/react';
import { activeNavKey, businessInitials, type DashNavKey } from '@/lib/dashChrome';
import { BG_CARD, CARD_SHADOW, FONT_BODY, TEXT_DARK, TEXT_MUTED, brandVar } from '@/lib/theme';

// Dash chrome top bar (InvestIQ reference): logo chip far left, pill nav
// center (active = white pill + dark circular icon chip), bell + avatar
// chips far right. Mobile keeps only logo + bell; the bottom MobileNav
// stays the primary navigation there.

const CHIP: React.CSSProperties = {
  width: 40, height: 40, borderRadius: '50%',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: BG_CARD, boxShadow: CARD_SHADOW, flexShrink: 0,
};

function NavPill({ href, label, icon, active }: {
  href: string; label: string; icon: React.ReactNode; active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        borderRadius: 99, textDecoration: 'none',
        padding: active ? '5px 16px 5px 5px' : '5px 14px',
        background: active ? BG_CARD : 'rgba(255,255,255,0.45)',
        boxShadow: active ? CARD_SHADOW : 'none',
        color: active ? TEXT_DARK : TEXT_MUTED,
        fontFamily: FONT_BODY, fontSize: 13, fontWeight: active ? 600 : 500,
      }}
    >
      <span aria-hidden style={{
        width: 28, height: 28, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active ? TEXT_DARK : 'transparent',
        color: active ? '#ede6e6' : TEXT_MUTED,
      }}>
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function TopBar({ sessionId, businessName, logoUrl, openIncidents }: {
  sessionId: string;
  businessName: string | null;
  logoUrl: string | null;
  openIncidents: number;
}) {
  const pathname = usePathname() ?? '';
  const active: DashNavKey = activeNavKey(pathname);

  const navItems: { key: DashNavKey; href: string; label: string; icon: React.ReactNode }[] = [
    {
      key: 'dashboard',
      href: `/dash/${sessionId}`,
      label: 'Dashboard',
      icon: <SquaresFour size={15} weight={active === 'dashboard' ? 'fill' : 'regular'} />,
    },
    {
      key: 'leads',
      href: `/dash/${sessionId}/leads`,
      label: 'Leads',
      icon: <UsersThree size={15} weight={active === 'leads' ? 'fill' : 'regular'} />,
    },
  ];

  return (
    <header
      className="dash-topbar"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, maxWidth: 1100, margin: '0 auto',
      }}
    >
      <style>{`
        /* Respect the iPhone notch/Dynamic Island when installed as a PWA
           (viewport-fit=cover): top padding grows by the safe-area inset.
           Class-based (not inline): jsdom/CSSOM drops env() inline values. */
        .dash-topbar { padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; }
        @media (max-width: 640px) { .dash-topnav, .dash-avatar { display: none !important; } }
      `}</style>

      {/* Logo chip: tenant logo when set; default is the inline Auto Mate
          lockup ("auto mate" black + "AI" orange), trimmed to its content box
          so height-based sizing renders at full wordmark size. */}
      <span style={{ ...CHIP, width: 'auto', minWidth: 40, borderRadius: 99, padding: '0 12px' }}>
        <img
          src={logoUrl ?? '/logo-inline.png'}
          alt={logoUrl ? (businessName ?? 'Client logo') : 'Auto Mate AI'}
          height={18}
          style={{ width: 'auto', maxWidth: 120, objectFit: 'contain', display: 'block' }}
        />
      </span>

      {/* Center pill nav */}
      <nav className="dash-topnav" aria-label="Dashboard" style={{ display: 'flex', gap: 6 }}>
        {navItems.map(item => (
          <NavPill key={item.key} href={item.href} label={item.label} icon={item.icon} active={active === item.key} />
        ))}
      </nav>

      {/* Right chips: bell with open-incident badge + client initials avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...CHIP, position: 'relative', color: TEXT_DARK }} aria-label={`${openIncidents} open incidents`}>
          <Bell size={17} weight="regular" aria-hidden />
          {openIncidents > 0 && (
            <span data-testid="incident-badge" style={{
              position: 'absolute', top: -2, right: -2,
              minWidth: 16, height: 16, borderRadius: 99, padding: '0 4px',
              background: brandVar, color: '#fff',
              fontSize: 9, fontWeight: 700, fontFamily: FONT_BODY,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {openIncidents}
            </span>
          )}
        </span>
        <span className="dash-avatar" style={{
          ...CHIP, background: TEXT_DARK, color: '#ede6e6',
          fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
        }} aria-label={businessName ?? 'Client'}>
          {businessInitials(businessName)}
        </span>
      </div>
    </header>
  );
}
