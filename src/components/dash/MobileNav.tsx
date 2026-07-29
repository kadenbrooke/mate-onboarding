'use client';
import { House, UsersThree, CurrencyDollar, Robot } from '@phosphor-icons/react';
import { FONT_BODY, BG_CARD, BORDER_SOFT, TEXT_MUTED, brandVar } from '@/lib/theme';
export type MobileView = 'home' | 'leads' | 'money' | 'crew';

// Bottom tab bar (<=640px only). Icon + label per tab, >=48px touch targets,
// bottom padding clears the iPhone home indicator (safe-area-inset-bottom).
// Active tab: brand color + filled icon + top indicator bar so the state
// reads instantly on the light theme.

export function MobileNav({ view, onChange }: { view: MobileView; onChange: (v: MobileView) => void }) {
  const tabs: { key: MobileView; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    { key: 'home', label: 'Home', icon: a => <House size={20} weight={a ? 'fill' : 'regular'} /> },
    { key: 'leads', label: 'Leads', icon: a => <UsersThree size={20} weight={a ? 'fill' : 'regular'} /> },
    { key: 'money', label: 'Money', icon: a => <CurrencyDollar size={20} weight={a ? 'fill' : 'regular'} /> },
    { key: 'crew', label: 'Crew', icon: a => <Robot size={20} weight={a ? 'fill' : 'regular'} /> },
  ];
  return (
    <nav
      className="dash-nav"
      data-testid="mobile-nav"
      aria-label="Dashboard sections"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex',
        background: BG_CARD, borderTop: `1px solid ${BORDER_SOFT}`, zIndex: 50,
      }}
    >
      {/* Home-indicator clearance. Class-based (not inline): jsdom/CSSOM
          drops env() inline values, and this keeps the rule testable. */}
      <style>{`
        .dash-nav { padding-bottom: env(safe-area-inset-bottom, 0px); }
      `}</style>
      {tabs.map(t => {
        const active = view === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1, minHeight: 52, padding: '7px 0 6px',
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3, position: 'relative',
              color: active ? brandVar : TEXT_MUTED,
              fontFamily: FONT_BODY, fontWeight: active ? 600 : 400, fontSize: 10,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* Active indicator bar along the top edge of the tab */}
            {active && (
              <span aria-hidden style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                width: 28, height: 3, borderRadius: '0 0 3px 3px', background: brandVar,
              }} />
            )}
            <span aria-hidden style={{ display: 'inline-flex' }}>{t.icon(active)}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
