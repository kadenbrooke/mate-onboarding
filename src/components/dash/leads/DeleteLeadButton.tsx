'use client';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import {
  BG_CARD, BORDER_SOFT, CARD_SHADOW, FONT_BODY, SCORE_RED, TEXT_DARK, TEXT_FAINT, TEXT_MUTED,
} from '@/lib/theme';

// Per-row delete. Destructive and irreversible, so the trash icon never deletes
// on its own: it opens a small confirm popover anchored to the row, and only
// "Yes" fires the request. Same popover on desktop and mobile (the mobile card
// list reuses this component), so there is one confirmation path to reason
// about, not two.

export function DeleteLeadButton({ leadId, sessionId, name, onDeleted, testId }: {
  leadId: string;
  sessionId: string;
  name: string | null;
  onDeleted: () => void;
  testId: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = name?.trim() || 'this lead';

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'Could not remove this lead.');
        setBusy(false);
        return;
      }
      setConfirming(false);
      onDeleted();
    } catch {
      setError('Could not remove this lead.');
      setBusy(false);
    }
  }

  return (
    <span
      style={{ display: 'inline-flex', position: 'relative' }}
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid={testId}
        aria-label={`Remove ${who}`}
        aria-expanded={confirming}
        onClick={() => { setConfirming(c => !c); setError(null); }}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 5,
          color: confirming ? SCORE_RED : TEXT_FAINT, display: 'inline-flex', lineHeight: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Trash size={14} weight={confirming ? 'fill' : 'regular'} aria-hidden />
      </button>

      {confirming && (
        <span
          role="alertdialog"
          aria-label={`Remove ${who}`}
          data-testid={`${testId}-confirm`}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
            width: 230, background: BG_CARD, border: `1px solid ${BORDER_SOFT}`,
            borderRadius: 12, boxShadow: CARD_SHADOW, padding: 12,
            fontFamily: FONT_BODY, color: TEXT_DARK, textAlign: 'left',
          }}
        >
          <span style={{ display: 'block', fontSize: 12, lineHeight: 1.4 }}>
            Are you sure you want to remove from your database? This action cannot be undone.
          </span>
          {error && (
            <span role="alert" style={{ display: 'block', marginTop: 6, fontSize: 11, color: SCORE_RED }}>
              {error}
            </span>
          )}
          <span style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              data-testid={`${testId}-yes`}
              onClick={remove}
              disabled={busy}
              style={{
                flex: 1, minHeight: 34, borderRadius: 99, cursor: busy ? 'default' : 'pointer',
                border: `1px solid ${SCORE_RED}`, background: SCORE_RED, color: '#fff',
                fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Removing' : 'Yes'}
            </button>
            <button
              type="button"
              data-testid={`${testId}-no`}
              onClick={() => setConfirming(false)}
              disabled={busy}
              style={{
                flex: 1, minHeight: 34, borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${BORDER_SOFT}`, background: BG_CARD, color: TEXT_MUTED,
                fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600,
              }}
            >
              No
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
