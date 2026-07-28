'use client';
import { FONT_BODY } from '@/lib/theme';
export type MobileView = 'home' | 'leads' | 'money' | 'crew';

export function MobileNav({ view, onChange }: { view: MobileView; onChange: (v: MobileView) => void }) {
  const tabs: { key: MobileView; label: string }[] = [
    { key: 'home', label: 'Home' }, { key: 'leads', label: 'Leads' },
    { key: 'money', label: 'Money' }, { key: 'crew', label: 'Crew' },
  ];
  return (
    <nav className="dash-nav" style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex',
      background: '#161616', borderTop: '1px solid #262626', zIndex: 50,
    }}>
      {tabs.map(t => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          style={{
            flex: 1, padding: '12px 0', background: 'none', border: 'none',
            color: view === t.key ? 'var(--brand-primary, #e14d1a)' : '#888',
            fontFamily: FONT_BODY, fontWeight: view === t.key ? 600 : 400, fontSize: 12, cursor: 'pointer',
          }}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
