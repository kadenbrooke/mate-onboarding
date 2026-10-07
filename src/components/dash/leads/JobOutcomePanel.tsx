'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Trash } from '@phosphor-icons/react';
import {
  parseDollarsToCents, centsToInput, MAX_LOST_REASON, type JobOutcome,
} from '@/lib/leads/outcome';
import {
  BG_CARD, BG_SECTION, BORDER_SOFT, FONT_BODY, TEXT_DARK, TEXT_MUTED, FREE_GREEN, LOST_BROWN, SCORE_RED, NUM_DISPLAY,
} from '@/lib/theme';

// "How did this job end?" for one lead, under its conversation in the pipeline
// (migration 0021). Built for the office assistant on a phone: two big
// buttons and Save for the outcome, then, on a won job, one payment at a time
// (amount, date, Add) with the running total on top. Nothing here touches the
// pipeline stage; that stays on the table.
//
// Each payment is its own row with its own date, never an edited total, so the
// dashboard counts cash in the month it actually came in. A mistyped payment
// is removed and entered again.
//
// The form state seeds from props once: the page keys this component by lead
// id, so switching leads remounts it with that lead's saved outcome. After a
// save, router.refresh() brings the new payments and total back from the
// server.

export type OutcomeFields = {
  job_outcome: JobOutcome | null;
  job_value_cents: number | null;
  lost_reason: string | null;
};

export type PanelPayment = { id: string; amount_cents: number; paid_at: string };

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

const primaryButton: React.CSSProperties = {
  minHeight: TAP, borderRadius: 12, border: 'none', cursor: 'pointer',
  background: TEXT_DARK, color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY,
};

/** $4,250 or $4,250.50, signed. */
export function dollars(cents: number): string {
  const abs = Math.abs(cents);
  const text = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2,
  });
  return `${cents < 0 ? '-' : ''}$${text}`;
}

/** Today in the viewer's own timezone, as the date input wants it. */
function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function JobOutcomePanel({ leadId, sessionId, initial, payments }: {
  leadId: string; sessionId: string; initial: OutcomeFields; payments: PanelPayment[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<JobOutcome | null>(initial.job_outcome);
  const [value, setValue] = useState(centsToInput(initial.job_value_cents));
  const [reason, setReason] = useState(initial.lost_reason ?? '');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => localToday());
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const total = payments.reduce((t, p) => t + p.amount_cents, 0);
  const hasPayments = payments.length > 0;

  async function call(url: string, method: 'PATCH' | 'POST' | 'DELETE', body: Record<string, unknown> | null, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, ...body }) } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage({ tone: 'error', text: typeof err.error === 'string' ? `Not saved: ${err.error}` : 'Not saved. Try again.' });
        return false;
      }
      setMessage({ tone: 'ok', text: done });
      router.refresh();
      return true;
    } catch {
      setMessage({ tone: 'error', text: 'Not saved. Check the connection and try again.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const outcomeUrl = `/api/leads/${leadId}/outcome`;

  function save() {
    if (busy || !outcome) return;
    if (outcome === 'lost') {
      call(outcomeUrl, 'PATCH', { outcome: 'lost', lost_reason: reason.trim() || null }, 'Saved as lost.');
      return;
    }
    const v = parseDollarsToCents(value);
    if (!v.ok) {
      setMessage({ tone: 'error', text: 'Use a dollar amount like 4250 or 4250.50.' });
      return;
    }
    call(outcomeUrl, 'PATCH', { outcome: 'won', job_value_cents: v.cents }, 'Saved as won.');
  }

  function clear() {
    if (busy) return;
    call(outcomeUrl, 'PATCH', { outcome: null }, 'Outcome cleared.');
  }

  async function addPayment() {
    if (busy) return;
    const a = parseDollarsToCents(amount);
    if (!a.ok || !a.cents) {
      setMessage({ tone: 'error', text: 'Enter the amount, like 2000 or 2000.50.' });
      return;
    }
    if (!paidOn) {
      setMessage({ tone: 'error', text: 'Pick the date the money came in.' });
      return;
    }
    // Today goes in as "now"; an earlier day as noon that day, so it lands on
    // that date in any US timezone.
    const paidAt = paidOn === localToday() ? undefined : new Date(`${paidOn}T12:00:00`).toISOString();
    const ok = await call(`/api/leads/${leadId}/payments`, 'POST', {
      amount_cents: refund ? -a.cents : a.cents, ...(paidAt ? { paid_at: paidAt } : {}),
    }, refund ? 'Refund recorded.' : 'Payment recorded.');
    if (ok) { setAmount(''); setRefund(false); setPaidOn(localToday()); }
  }

  function removePayment(id: string) {
    if (busy) return;
    call(`/api/leads/${leadId}/payments/${id}?session_id=${encodeURIComponent(sessionId)}`, 'DELETE', null, 'Payment removed.');
  }

  const choice = (kind: JobOutcome, label: string, color: string, Icon: typeof CheckCircle, disabled = false) => {
    const on = outcome === kind;
    return (
      <button type="button" onClick={() => { setOutcome(kind); setMessage(null); }} aria-pressed={on} disabled={busy || disabled}
        style={{
          flex: 1, minHeight: TAP, borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, opacity: disabled ? 0.45 : 1,
          border: `2px solid ${on ? color : BORDER_SOFT}`,
          background: on ? color : '#fff', color: on ? '#fff' : TEXT_DARK,
        }}>
        <Icon size={20} weight={on ? 'fill' : 'regular'} aria-hidden /> {label}
      </button>
    );
  };

  const savedWon = initial.job_outcome === 'won';

  return (
    <div data-testid="job-outcome" style={{ background: BG_CARD, borderRadius: 12, padding: 12, display: 'grid', gap: 12, fontFamily: FONT_BODY }}>
      <div>
        <div style={{ color: TEXT_DARK, fontSize: 14, fontWeight: 600 }}>How did this job end?</div>
        <div style={{ color: TEXT_MUTED, fontSize: 12 }}>
          Counts toward your return by lead source on the dashboard.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {choice('won', 'Won', FREE_GREEN, CheckCircle)}
        {choice('lost', 'Lost', LOST_BROWN, XCircle, hasPayments)}
      </div>

      {outcome === 'won' && (
        <label style={labelStyle}>
          Sold for ($)
          <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" autoComplete="off"
            placeholder="e.g. 4250" style={inputStyle} />
        </label>
      )}

      {outcome === 'lost' && (
        <label style={labelStyle}>
          Why was it lost? (optional)
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={MAX_LOST_REASON}
            placeholder="e.g. went with a cheaper bid" style={inputStyle} />
        </label>
      )}

      {outcome && (
        <button type="button" onClick={save} disabled={busy} style={primaryButton}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      )}

      {savedWon && (
        <div data-testid="job-payments" style={{ display: 'grid', gap: 10, paddingTop: 12, borderTop: `1px solid ${BORDER_SOFT}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>Cash collected so far</span>
            <span data-testid="job-payments-total" style={{ ...NUM_DISPLAY, fontSize: 20, color: total > 0 ? FREE_GREEN : TEXT_MUTED }}>
              {dollars(total)}
            </span>
          </div>

          {hasPayments && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {payments.map(p => (
                <li key={p.id} data-testid="job-payment" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '4px 8px', borderRadius: 8, background: BG_SECTION, fontSize: 14,
                }}>
                  <span suppressHydrationWarning style={{ color: TEXT_MUTED }}>
                    {new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: p.amount_cents < 0 ? SCORE_RED : TEXT_DARK }}>
                    {p.amount_cents < 0 ? `Refund ${dollars(-p.amount_cents)}` : dollars(p.amount_cents)}
                  </span>
                  <button type="button" onClick={() => removePayment(p.id)} disabled={busy}
                    aria-label={`Remove ${p.amount_cents < 0 ? 'refund' : 'payment'} of ${dollars(Math.abs(p.amount_cents))}`}
                    style={{
                      minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'transparent', border: 'none', cursor: 'pointer', color: TEXT_MUTED,
                    }}>
                    <Trash size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={labelStyle}>
              {refund ? 'Refund amount ($)' : 'Payment amount ($)'}
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoComplete="off"
                placeholder="e.g. 2000" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Date received
              <input type="date" value={paidOn} max={localToday()} onChange={e => setPaidOn(e.target.value)} style={inputStyle} />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT_DARK, minHeight: 32 }}>
            <input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} style={{ width: 20, height: 20 }} />
            This is a refund or chargeback
          </label>
          <span style={{ fontSize: 12, color: TEXT_MUTED }}>Leave out sales tax.</span>
          <button type="button" onClick={addPayment} disabled={busy} style={primaryButton}>
            {busy ? 'Saving...' : refund ? 'Add refund' : 'Add payment'}
          </button>
        </div>
      )}

      {initial.job_outcome !== null && (
        hasPayments
          ? <div style={{ fontSize: 12, color: TEXT_MUTED }}>To change a won job, remove its payments first.</div>
          : (
            <button type="button" onClick={clear} disabled={busy}
              style={{
                justifySelf: 'start', background: 'transparent', border: 'none', padding: '4px 0',
                color: TEXT_MUTED, fontSize: 13, fontFamily: FONT_BODY, textDecoration: 'underline', cursor: 'pointer',
              }}>
              Clear the outcome
            </button>
          )
      )}

      {message && (
        <div role="status" style={{ fontSize: 13, color: message.tone === 'ok' ? FREE_GREEN : SCORE_RED }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
