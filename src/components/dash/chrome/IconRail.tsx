'use client';
import { usePathname } from 'next/navigation';
import { Funnel, Timer, ArrowsClockwise, Star, CalendarBlank, Megaphone } from '@phosphor-icons/react';
import { RAIL_SECTIONS, activeNavKey } from '@/lib/dashChrome';
import { BG_CARD, CARD_SHADOW, TEXT_MUTED } from '@/lib/theme';

// Floating left icon rail (desktop only): circular white chips that smooth-
// scroll to the dashboard zones. Rendered only on the dashboard page, where
// the scroll targets exist.

const SECTION_ICONS: Record<(typeof RAIL_SECTIONS)[number]['id'], React.ReactNode> = {
  'zone-leadflow': <Funnel size={17} weight="regular" />,
  'zone-speed': <Timer size={17} weight="regular" />,
  'zone-ads': <Megaphone size={17} weight="regular" />,
  'zone-followup': <ArrowsClockwise size={17} weight="regular" />,
  'zone-reputation': <Star size={17} weight="regular" />,
  'zone-calendar': <CalendarBlank size={17} weight="regular" />,
};

export function IconRail() {
  const pathname = usePathname() ?? '';
  if (activeNavKey(pathname) !== 'dashboard') return null;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      className="dash-rail"
      aria-label="Jump to section"
      style={{
        position: 'fixed', left: 14, top: '50%', transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 40,
      }}
    >
      {RAIL_SECTIONS.map(s => (
        <button
          key={s.id}
          type="button"
          title={s.label}
          aria-label={`Scroll to ${s.label}`}
          onClick={() => scrollTo(s.id)}
          style={{
            width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: BG_CARD, boxShadow: CARD_SHADOW, color: TEXT_MUTED,
          }}
        >
          {SECTION_ICONS[s.id]}
        </button>
      ))}
    </nav>
  );
}
