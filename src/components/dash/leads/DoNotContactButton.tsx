'use client';
import { useState } from 'react';
import { CheckCircle, PhoneDisconnect } from '@phosphor-icons/react';
import { BG_CARD, BORDER_SOFT, FONT_BODY, SCORE_RED, TEXT_DARK, TEXT_MUTED } from '@/lib/theme';

export type DoNotContactReceipt = { recordedBy: string; recordedAt: string };

export function DoNotContactButton({ leadId, sessionId, initial }: {
  leadId: string; sessionId: string; initial?: DoNotContactReceipt | null;
}) {
  const [receipt, setReceipt] = useState<DoNotContactReceipt | null>(initial ?? null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/do-not-contact`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Opt-out could not be recorded.');
        return;
      }
      setReceipt({ recordedBy: body.recorded_by ?? 'signed-in user', recordedAt: body.recorded_at ?? new Date().toISOString() });
      setConfirming(false);
    } catch {
      setError('Opt-out could not be recorded. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <div data-testid="do-not-contact-state" style={{ display: 'grid', gap: 3, padding: 10, borderRadius: 10, background: '#fff5f3', border: `1px solid ${SCORE_RED}`, fontFamily: FONT_BODY }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: SCORE_RED, fontSize: 14, fontWeight: 700 }}>
          <CheckCircle size={18} weight="fill" aria-hidden /> Do not contact
        </div>
        <div style={{ color: TEXT_MUTED, fontSize: 12 }}>
          Recorded by {receipt.recordedBy} · {new Date(receipt.recordedAt).toLocaleString()}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6, fontFamily: FONT_BODY }}>
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm do not contact" style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, background: BG_CARD, border: `1px solid ${BORDER_SOFT}` }}>
          <div style={{ color: TEXT_DARK, fontSize: 13, fontWeight: 600 }}>They asked us not to contact them</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={record} disabled={busy} style={{ minHeight: 48, flex: 1, border: 'none', borderRadius: 10, background: SCORE_RED, color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Recording…' : 'Yes, do not contact'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} style={{ minHeight: 48, flex: 1, border: `1px solid ${BORDER_SOFT}`, borderRadius: 10, background: BG_CARD, color: TEXT_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setConfirming(true); setError(null); }} style={{ minHeight: 48, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: `1px solid ${SCORE_RED}`, borderRadius: 10, background: BG_CARD, color: SCORE_RED, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          <PhoneDisconnect size={18} weight="bold" aria-hidden /> Do not contact
        </button>
      )}
      {error && <div role="alert" style={{ color: SCORE_RED, fontSize: 12 }}>{error}</div>}
    </div>
  );
}
