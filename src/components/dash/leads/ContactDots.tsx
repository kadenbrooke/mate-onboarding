'use client';
import { useEffect, useRef, useState } from 'react';
import { Phone, EnvelopeSimple, MapPin } from '@phosphor-icons/react';
import { CARD_BG, CARD_FG, CARD_HAIRLINE, CARD_MUTED, CARD_TRACK, FONT_BODY, brandVar } from '@/lib/theme';

// Three 14px circles per pipeline row: phone, email, address. Filled (brand
// accent + dark glyph) when we hold that datum, hollow (hairline ring + muted
// glyph) when we do not -- so an operator can see at a glance which leads are
// still missing contact info, without widening the table by three columns.
//
// Visual spec is the cultivator sequence dots from the Auto Mate 5 demo:
// 14px circle, filled = accent background with a dark icon, empty = 1px border
// with a muted icon. Adapted to the InvestIQ light theme via the per-card CSS
// vars (CARD_*) so the dots stay legible when a card is flipped to dark.
//
// Reveal: hover on desktop, tap on mobile (both drive the same `openKey`
// state, so there is one popover implementation, not two). The dot is 14px but
// the button carries 5px of transparent padding, giving a 24px touch target
// without changing the drawn size.

type DotKey = 'phone' | 'email' | 'address';

const ICONS = { phone: Phone, email: EnvelopeSimple, address: MapPin } as const;
const NOUN = { phone: 'phone number', email: 'email', address: 'address' } as const;

export function ContactDots({ lead, testId }: {
  lead: { name: string | null; phone?: string | null; email?: string | null; address?: string | null };
  testId: string;
}) {
  const [openKey, setOpenKey] = useState<DotKey | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Tap-outside closes the popover on touch, where there is no mouseleave.
  useEffect(() => {
    if (!openKey) return;
    const onDocPointer = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [openKey]);

  const values: Record<DotKey, string | null> = {
    phone: lead.phone?.trim() || null,
    email: lead.email?.trim() || null,
    address: lead.address?.trim() || null,
  };
  const who = lead.name?.trim() || 'this lead';

  return (
    <span
      ref={wrapRef}
      className="contact-dots"
      data-testid={testId}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, position: 'relative' }}
      onClick={e => e.stopPropagation()}
    >
      {(['phone', 'email', 'address'] as DotKey[]).map(key => {
        const value = values[key];
        const has = value != null;
        const Icon = ICONS[key];
        const open = openKey === key;
        return (
          <button
            key={key}
            type="button"
            data-testid={`${testId}-${key}`}
            data-has={has ? 'true' : 'false'}
            aria-label={has ? `${NOUN[key]} for ${who}: ${value}` : `no ${NOUN[key]} for ${who}`}
            aria-expanded={has ? open : undefined}
            disabled={!has}
            onClick={() => has && setOpenKey(k => (k === key ? null : key))}
            onMouseEnter={() => has && setOpenKey(key)}
            onMouseLeave={() => setOpenKey(k => (k === key ? null : k))}
            onFocus={() => has && setOpenKey(key)}
            onBlur={() => setOpenKey(k => (k === key ? null : k))}
            style={{
              padding: 5, border: 'none', background: 'transparent', lineHeight: 0,
              cursor: has ? 'pointer' : 'default',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14, height: 14, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: has ? brandVar : 'transparent',
                border: has ? '1px solid transparent' : `1px solid ${CARD_TRACK}`,
                color: has ? '#fff' : CARD_MUTED,
                transition: 'background 120ms',
              }}
            >
              <Icon size={8} weight={has ? 'fill' : 'regular'} />
            </span>
          </button>
        );
      })}

      {openKey && values[openKey] && (
        <span
          role="tooltip"
          data-testid={`${testId}-popover`}
          style={{
            position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 20,
            maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: CARD_BG, color: CARD_FG,
            border: `1px solid ${CARD_HAIRLINE}`, borderRadius: 8,
            boxShadow: '0 4px 14px rgba(20,20,20,0.12)',
            padding: '5px 9px', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500,
          }}
        >
          {values[openKey]}
        </span>
      )}
    </span>
  );
}
