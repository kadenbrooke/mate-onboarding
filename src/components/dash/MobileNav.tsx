'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, UsersThree, CurrencyDollar, ChartLineUp, Microphone } from '@phosphor-icons/react';
import { FONT_BODY, BG_CARD, BORDER_SOFT, TEXT_MUTED, brandVar } from '@/lib/theme';
export type MobileView = 'home' | 'leads' | 'money' | 'crew' | 'assistant';

// Bottom tab bar (<=640px only). Icon + label per tab, >=48px touch targets,
// bottom padding clears the iPhone home indicator (safe-area-inset-bottom).
// Active tab: brand color + filled icon + top indicator bar so the state
// reads instantly on the light theme.
//
// Assistant tab (center) is a raised orange-gradient FAB, not a plain tab:
// Ben wants clients talking to the agent constantly, so it needs to read as
// "the one to press" at a glance rather than blend in with the other four.
// Tap opens the Assistant chat view (same as today). Press-and-hold-to-talk
// is a follow-up: it needs mic capture + a voice pipeline on the backend,
// which is Kaden's lane, not built here.
//
// Two modes (2026-07: standalone /leads and /assistant pages had NO way
// back and no bottom nav at all -- this fixes both):
// - Tab mode (`view`+`onChange`): used on the dashboard root, where Home/
//   Leads/Money/Crew are in-page SortableStack views, not real routes.
//   Unchanged from before.
// - Link mode (`sessionId`): used on standalone sub-pages (the full leads
//   table, the standalone assistant page). Leads/Assistant navigate to
//   their real routes; Home/Money/Crew navigate back to the dashboard root
//   (they have no standalone route of their own). Active state comes from
//   the URL, not a `view` prop.
//
// Deliberately renders <Link> and <button> as separate, explicit JSX blocks
// (not swapped through a `const Tag = condition ? Link : 'button'` variable)
// -- that pattern broke Next 16 / Turbopack's RSC boundary analysis during
// static generation of the preview pages ("createContext is not a
// function"). Explicit branches cost a bit of duplication but build clean.

const TABS: { key: MobileView; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { key: 'home', label: 'Home', icon: a => <House size={20} weight={a ? 'fill' : 'regular'} /> },
  { key: 'leads', label: 'Leads', icon: a => <ChartLineUp size={20} weight={a ? 'fill' : 'regular'} /> },
  { key: 'assistant', label: 'Assistant', icon: () => <Microphone size={24} weight="fill" /> },
  { key: 'money', label: 'Money', icon: a => <CurrencyDollar size={20} weight={a ? 'fill' : 'regular'} /> },
  { key: 'crew', label: 'Crew', icon: a => <UsersThree size={20} weight={a ? 'fill' : 'regular'} /> },
];

function hrefFor(key: MobileView, sessionId: string): string {
  if (key === 'leads') return `/dash/${sessionId}/leads`;
  if (key === 'assistant') return `/dash/${sessionId}/assistant`;
  return `/dash/${sessionId}`; // home, money, crew have no standalone route
}

const FAB_STYLE: React.CSSProperties = {
  flex: 1, minHeight: 52, padding: '0 0 6px',
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'flex-end', gap: 4, position: 'relative',
  textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
};

const TAB_STYLE = (active: boolean): React.CSSProperties => ({
  flex: 1, minHeight: 52, padding: '7px 0 6px',
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 3, position: 'relative',
  color: active ? brandVar : TEXT_MUTED,
  fontFamily: FONT_BODY, fontWeight: active ? 600 : 400, fontSize: 10,
  textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
});

function FabInner({ active, icon, label }: { active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <>
      <span
        aria-hidden
        className="dash-nav-fab"
        style={{
          width: 54, height: 54, borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', marginTop: -22,
          transform: active ? 'scale(1.04)' : 'scale(1)',
          transition: 'transform 120ms ease',
        }}
      >
        {icon}
      </span>
      <span style={{
        color: active ? brandVar : TEXT_MUTED,
        fontFamily: FONT_BODY, fontWeight: active ? 600 : 400, fontSize: 10,
      }}>
        {label}
      </span>
    </>
  );
}

function TabInner({ active, icon, label }: { active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <>
      {/* Active indicator bar along the top edge of the tab */}
      {active && (
        <span aria-hidden style={{
          position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
          width: 28, height: 3, borderRadius: '0 0 3px 3px', background: brandVar,
        }} />
      )}
      <span aria-hidden style={{ display: 'inline-flex' }}>{icon}</span>
      {label}
    </>
  );
}

type MobileNavProps =
  | { view: MobileView; onChange: (v: MobileView) => void; sessionId?: never }
  | { sessionId: string; view?: never; onChange?: never };

export function MobileNav(props: MobileNavProps) {
  const pathname = usePathname() ?? '';
  const linkMode = 'sessionId' in props && props.sessionId != null;
  const sessionId = linkMode ? props.sessionId! : undefined;

  const isActive = (key: MobileView): boolean => {
    if (!linkMode) return props.view === key;
    if (key === 'leads') return pathname === `/dash/${sessionId}/leads`;
    if (key === 'assistant') return pathname === `/dash/${sessionId}/assistant`;
    return key === 'home' && pathname === `/dash/${sessionId}`;
  };

  return (
    <nav
      className="dash-nav"
      data-testid="mobile-nav"
      aria-label="Dashboard sections"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex',
        alignItems: 'flex-end',
        background: BG_CARD, borderTop: `1px solid ${BORDER_SOFT}`, zIndex: 50,
      }}
    >
      {/* Home-indicator clearance. Class-based (not inline): jsdom/CSSOM
          drops env() inline values, and this keeps the rule testable. */}
      <style>{`
        .dash-nav { padding-bottom: env(safe-area-inset-bottom, 0px); }
        .dash-nav-fab {
          background: linear-gradient(145deg, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, white 25%), var(--brand-primary, #e14d1a));
          box-shadow: 0 6px 16px color-mix(in srgb, var(--brand-primary, #e14d1a) 45%, transparent), 0 0 0 4px ${BG_CARD};
        }
      `}</style>
      {TABS.map(t => {
        const active = isActive(t.key);
        const inner = t.key === 'assistant'
          ? <FabInner active={active} icon={t.icon(active)} label={t.label} />
          : <TabInner active={active} icon={t.icon(active)} label={t.label} />;
        const style = t.key === 'assistant' ? FAB_STYLE : TAB_STYLE(active);

        if (linkMode) {
          return (
            <Link key={t.key} href={hrefFor(t.key, sessionId!)} aria-current={active ? 'page' : undefined} style={style}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => props.onChange!(t.key)}
            aria-current={active ? 'page' : undefined}
            style={style}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
