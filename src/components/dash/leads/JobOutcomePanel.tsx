'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import {
  parseDollarsToCents, centsToInput, MAX_LOST_REASON, type JobOutcome,
} from '@/lib/leads/outcome';
import {
  BG_CARD, BORDER_SOFT, FONT_BODY, TEXT_DARK, TEXT_MUTED, FREE_GREEN, LOST_BROWN, SCORE_RED,
} from '@/lib/theme';

// "How did this job end?" for one lead, under its conversation in the pipeline
// (migration 0021). Built for the office assistant on a phone: two big
// buttons, then at most two money boxes with the number keypad, then Save.
// Nothing here touches the pipeline stage; that stays on the table.
//
// The form state seeds from `initial` once: the page keys this component by
// lead id, so switching leads remounts it with that lead's saved outcome.

export type OutcomeFields = {
  job_outcome: JobOutcome | null;
  job_value_cents: number | null;
  collected_cents: number | null;
  lost_reason: string | null;
};

const TAP = 48; // minimum touch target, px

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: TAP, padding: '0 12px',
  borderRadius: 10, border: `1px solid ${BORDER_SOFT}`, background: '#fff',
  // 16px keeps iOS from zooming the page when the box is focused.
  fontSize: 16, fontFamily: FONT_BODY, color: TEXT_DARK,
};

const labelStyle: React.CSSProperties = {
  display: 'grid', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, color: TEXT_DARK,
};

export function JobOutcomePanel({ leadId, sessionId, initial }: {
  leadId: string; sessionId: string; initial: OutcomeFields;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<JobOutcome | null>(initial.job_outcome);
  const [value, setValue] = useState(centsToInput(initial.job_value_cents));
  const [collected, setCollected] = useState(centsToInput(initial.collected_cents));
  const [reason, setReason] = useState(initial.lost_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/outcome`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, ...body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage({ tone: 'error', text: typeof err.error === 'string' ? `Not saved: ${err.error}` : 'Not saved. Try again.' });
        return;
      }
      setMessage({ tone: 'ok', text: done });
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Not saved. Check the connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (busy || !outcome) return;
    if (outcome === 'lost') {
      send({ outcome: 'lost', lost_reason: reason.trim() || null }, 'Saved as lost.');
      return;
    }
    const v = parseDollarsToCents(value);
    const c = parseDollarsToCents(collected);
    if (!v.ok || !c.ok) {
      setMessage({ tone: 'error', text: 'Use a dollar amount like 4250 or 4250.50.' });
      return;
    }
    send({ outcome: 'won', job_value_cents: v.cents, collected_cents: c.cents }, 'Saved as won.');
  }

  function clear() {
    if (busy) return;
    send({ outcome: null }, 'Outcome cleared.');
  }

  const choice = (kind: JobOutcome, label: string, color: string, Icon: typeof CheckCircle) => {
    const on = outcome === kind;
    return (
      <button type="button" onClick={() => { setOutcome(kind); setMessage(null); }} aria-pressed={on} disabled={busy}
        style={{
          flex: 1, minHeight: TAP, borderRadius: 12, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY,
          border: `2px solid ${on ? color : BORDER_SOFT}`,
          background: on ? color : '#fff', color: on ? '#fff' : TEXT_DARK,
        }}>
        <Icon size={20} weight={on ? 'fill' : 'regular'} aria-hidden /> {label}
      </button>
    );
  };

  const saved = initial.job_outcome !== null;

  return (
    <div data-testid="job-outcome" style={{ background: BG_CARD, borderRadius: 12, padding: 12, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ color: TEXT_DARK, fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY }}>How did this job end?</div>
        <div style={{ color: TEXT_MUTED, fontSize: 12, fontFamily: FONT_BODY }}>
          Counts toward your return by lead source on the dashboard.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {choice('won', 'Won', FREE_GREEN, CheckCircle)}
        {choice('lost', 'Lost', LOST_BROWN, XCircle)}
      </div>

      {outcome === 'won' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={labelStyle}>
            Sold for ($)
            <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" autoComplete="off"
              placeholder="e.g. 4250" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Cash collected so far ($)
            <input value={collected} onChange={e => setCollected(e.target.value)} inputMode="decimal" autoComplete="off"
              placeholder="e.g. 2000" style={inputStyle} />
            <span style={{ fontWeight: 400, fontSize: 12, color: TEXT_MUTED }}>
              Leave out sales tax. If you refund money, lower this number.
            </span>
          </label>
        </div>
      )}

      {outcome === 'lost' && (
        <label style={labelStyle}>
          Why was it lost? (optional)
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={MAX_LOST_REASON}
            placeholder="e.g. went with a cheaper bid" style={inputStyle} />
        </label>
      )}

      {outcome && (
        <button type="button" onClick={save} disabled={busy}
          style={{
            minHeight: TAP, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: TEXT_DARK, color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY,
          }}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      )}

      {saved && (
        <button type="button" onClick={clear} disabled={busy}
          style={{
            justifySelf: 'start', background: 'transparent', border: 'none', padding: '4px 0',
            color: TEXT_MUTED, fontSize: 13, fontFamily: FONT_BODY, textDecoration: 'underline', cursor: 'pointer',
          }}>
          Clear the outcome
        </button>
      )}

      {message && (
        <div role="status" style={{ fontSize: 13, fontFamily: FONT_BODY, color: message.tone === 'ok' ? FREE_GREEN : SCORE_RED }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
