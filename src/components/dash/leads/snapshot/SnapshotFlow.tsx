'use client';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import {
  Camera, Images, Keyboard, Plus, X, PaperPlaneTilt, CheckCircle, Clock, Warning, XCircle, MinusCircle, ArrowSquareOut,
} from '@phosphor-icons/react';
import {
  BG_CARD, BG_SECTION, BORDER_SOFT, CARD_SHADOW, TEXT_DARK, TEXT_MUTED, TEXT_FAINT,
  FONT_BODY, FONT_HEAD, FONT_HEAD_FEATURE, FONT_NUM, FREE_GREEN, SCORE_AMBER, SCORE_RED, brandVar,
} from '@/lib/theme';
import type { SnapshotCandidate } from '@/lib/leads/snapshotParse';
import { snapshotOpening, type OpeningTenant } from '@/lib/leads/snapshotOpening';
import { MAX_IMAGES_PER_REQUEST } from '@/lib/leads/snapshotImage';
import {
  rowsFromCandidates, blankRow, updateRow, submitState, sendLabel, sendableRows, displayPhone, duplicateMessage,
  type EditableRow, type DuplicateNote,
} from './confirmState';

// Add a lead, two ways in and one screen out:
//
//   capture  -> shoot or pick 1..5 photos and read them, OR type it in
//   confirm  -> one editable card per lead, a Text them switch on each,
//               consent box when anything will be texted, one button
//   result   -> per row: sent, queued, saved, duplicate, skipped, failed
//
// The confirm step is the safety story. Nothing is sent until a human has
// looked at every number and ticked the box. Rules live in confirmState.ts
// with tests; this file is layout.

type Step =
  | { kind: 'capture' }
  | { kind: 'reading' }
  | { kind: 'confirm'; snapshotId: string; rows: EditableRow[]; unreadable: string | null; typed: boolean }
  | { kind: 'sending'; snapshotId: string; rows: EditableRow[]; typed: boolean }
  | { kind: 'result'; outcomes: Outcome[]; hold: boolean; sendAfter: string | null };

type Outcome = {
  index: number;
  outcome: 'sent' | 'queued' | 'saved' | 'duplicate' | 'skipped' | 'invalid' | 'failed';
  message: string;
  lead_id?: string | null;
  send_after?: string | null;
};

type ExtractReply = {
  snapshot_id: string;
  candidates: SnapshotCandidate[];
  unreadable: string | null;
  duplicates: DuplicateNote[];
} | { error: string; snapshot_id?: string };

type ManualReply = { snapshot_id: string } | { error: string };

type ConfirmReply = { snapshot_id: string; hold: boolean; send_after: string | null; outcomes: Outcome[] } | { error: string };

type Picked = { file: File; url: string | null };

function makeUrl(file: File): string | null {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

export function SnapshotFlow({ sessionId, opener }: { sessionId: string; opener: OpeningTenant | null }) {
  const [step, setStep] = useState<Step>({ kind: 'capture' });
  const [picked, setPicked] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // Object URLs leak until revoked. Revoke whatever is no longer shown.
  useEffect(() => () => { picked.forEach(p => p.url && URL.revokeObjectURL(p.url)); }, [picked]);

  const addFiles = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setError(null);
    setPicked(prev => {
      const room = MAX_IMAGES_PER_REQUEST - prev.length;
      if (room <= 0) { setError(`Up to ${MAX_IMAGES_PER_REQUEST} photos at a time.`); return prev; }
      if (files.length > room) setError(`Up to ${MAX_IMAGES_PER_REQUEST} photos at a time. Kept the first ${room}.`);
      return [...prev, ...files.slice(0, room).map(file => ({ file, url: makeUrl(file) }))];
    });
  }, []);

  function removePicked(i: number) {
    setPicked(prev => {
      const gone = prev[i];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((_, j) => j !== i);
    });
  }

  async function read() {
    if (picked.length === 0) return;
    setError(null);
    setStep({ kind: 'reading' });
    const form = new FormData();
    picked.forEach(p => form.append('images', p.file, p.file.name));
    try {
      const res = await fetch(`/api/dash/${sessionId}/snapshot`, { method: 'POST', body: form });
      const body = (await res.json()) as ExtractReply;
      if (!res.ok || 'error' in body) {
        setError('error' in body ? body.error : 'Could not read that photo.');
        setStep({ kind: 'capture' });
        return;
      }
      const rows = rowsFromCandidates(body.candidates, body.duplicates ?? []);
      setConsent(false);
      setStep({ kind: 'confirm', snapshotId: body.snapshot_id, rows, unreadable: body.unreadable, typed: false });
    } catch {
      setError('Could not reach the reader. Check your connection and try again.');
      setStep({ kind: 'capture' });
    }
  }

  async function startTyped() {
    setError(null);
    setStep({ kind: 'reading' });
    try {
      const res = await fetch(`/api/dash/${sessionId}/leads/manual`, { method: 'POST' });
      const body = (await res.json()) as ManualReply;
      if (!res.ok || 'error' in body) {
        setError('error' in body ? body.error : 'Could not start.');
        setStep({ kind: 'capture' });
        return;
      }
      setConsent(false);
      setStep({ kind: 'confirm', snapshotId: body.snapshot_id, rows: [blankRow(0)], unreadable: null, typed: true });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setStep({ kind: 'capture' });
    }
  }

  async function send() {
    if (step.kind !== 'confirm') return;
    const gate = submitState(step.rows, consent);
    if (!gate.ok) return;
    const { snapshotId, rows, typed } = step;
    setError(null);
    setStep({ kind: 'sending', snapshotId, rows, typed });
    try {
      const res = await fetch(`/api/dash/${sessionId}/snapshot/${snapshotId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent,
          rows: rows.map(r => ({
            index: r.index, include: r.include && !r.duplicate, text: r.text,
            name: r.name || null, phone: r.phone || null, address: r.address || null,
            service: r.service || null, notes: r.notes || null,
          })),
        }),
      });
      const body = (await res.json()) as ConfirmReply;
      if (!res.ok || 'error' in body) {
        setError('error' in body ? body.error : 'Could not send.');
        setStep({ kind: 'confirm', snapshotId, rows, unreadable: null, typed });
        return;
      }
      setStep({ kind: 'result', outcomes: body.outcomes, hold: body.hold, sendAfter: body.send_after });
    } catch {
      setError('Could not reach the sender. Nothing was texted.');
      setStep({ kind: 'confirm', snapshotId, rows, unreadable: null, typed });
    }
  }

  function reset() {
    picked.forEach(p => p.url && URL.revokeObjectURL(p.url));
    setPicked([]);
    setConsent(false);
    setError(null);
    setStep({ kind: 'capture' });
  }

  return (
    <div style={{ fontFamily: FONT_BODY, color: TEXT_DARK, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div role="alert" style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fbeae7', color: SCORE_RED,
          borderRadius: 12, padding: '10px 12px', fontSize: 13,
        }}>
          <Warning size={18} weight="fill" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}

      {(step.kind === 'capture' || step.kind === 'reading') && (
        <CaptureStep
          picked={picked}
          reading={step.kind === 'reading'}
          onPick={() => libraryRef.current?.click()}
          onShoot={() => cameraRef.current?.click()}
          onType={startTyped}
          onRemove={removePicked}
          onRead={read}
        />
      )}

      {(step.kind === 'confirm' || step.kind === 'sending') && (
        <ConfirmStep
          sessionId={sessionId}
          rows={step.rows}
          typed={step.typed}
          unreadable={step.kind === 'confirm' ? step.unreadable : null}
          consent={consent}
          sending={step.kind === 'sending'}
          opener={opener}
          onRow={(index, patch) => {
            if (step.kind !== 'confirm') return;
            setStep({ ...step, rows: updateRow(step.rows, index, patch) });
          }}
          onAdd={() => {
            if (step.kind !== 'confirm') return;
            setStep({ ...step, rows: [...step.rows, blankRow(step.rows.length)] });
          }}
          onConsent={setConsent}
          onSend={send}
          onBack={reset}
        />
      )}

      {step.kind === 'result' && (
        <ResultStep sessionId={sessionId} outcomes={step.outcomes} hold={step.hold} sendAfter={step.sendAfter} onAgain={reset} />
      )}

      {/* Two inputs: `capture` opens the camera straight away on a phone, the
          other opens the library. Both hidden; the big buttons drive them. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={addFiles} data-testid="snapshot-camera-input" />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={addFiles} data-testid="snapshot-library-input" />
    </div>
  );
}

// ---------------------------------------------------------------------------

function CaptureStep({ picked, reading, onPick, onShoot, onType, onRemove, onRead }: {
  picked: Picked[]; reading: boolean;
  onPick: () => void; onShoot: () => void; onType: () => void; onRemove: (i: number) => void; onRead: () => void;
}) {
  return (
    <div style={{ background: BG_CARD, borderRadius: 16, padding: 16, boxShadow: CARD_SHADOW, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button type="button" onClick={onShoot} disabled={reading} style={bigButton(true)}>
        <Camera size={22} weight="bold" aria-hidden /> Take a photo
      </button>
      <button type="button" onClick={onPick} disabled={reading} style={bigButton(false)}>
        <Images size={20} weight="bold" aria-hidden /> Choose from library
      </button>
      <button type="button" onClick={onType} disabled={reading || picked.length > 0} style={bigButton(false)}>
        <Keyboard size={20} weight="bold" aria-hidden /> Type it in
      </button>

      {picked.length > 0 && (
        <ul aria-label="Photos to read" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {picked.map((p, i) => (
            <li key={`${p.file.name}-${i}`} style={{ position: 'relative', width: 84, height: 84, borderRadius: 10, overflow: 'hidden', background: BG_SECTION, border: `1px solid ${BORDER_SOFT}` }}>
              {p.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.url} alt={`Photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 11, color: TEXT_MUTED, padding: 6, display: 'block' }}>{p.file.name}</span>}
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onRemove(i)} disabled={reading} style={{
                position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, border: 'none',
                background: 'rgba(20,20,20,0.75)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}>
                <X size={13} weight="bold" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <button type="button" onClick={onRead} disabled={reading} style={primaryButton(reading)}>
          {reading ? 'Reading the photo' : picked.length > 1 ? `Read ${picked.length} photos` : 'Read the photo'}
        </button>
      )}
      <p style={{ margin: 0, fontSize: 12, color: TEXT_FAINT }}>
        Nothing is sent yet. You will check every name and number first.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConfirmStep({ sessionId, rows, typed, unreadable, consent, sending, opener, onRow, onAdd, onConsent, onSend, onBack }: {
  sessionId: string; rows: EditableRow[]; typed: boolean; unreadable: string | null; consent: boolean; sending: boolean;
  opener: OpeningTenant | null;
  onRow: (index: number, patch: Partial<EditableRow>) => void;
  onAdd: () => void;
  onConsent: (v: boolean) => void; onSend: () => void; onBack: () => void;
}) {
  const gate = submitState(rows, consent);
  const sample = sendableRows(rows)[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.length === 0 && (
        <div style={{ background: BG_CARD, borderRadius: 16, padding: 16, boxShadow: CARD_SHADOW }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Nothing readable in that photo.</p>
          {unreadable && <p style={{ margin: '6px 0 0', fontSize: 13, color: TEXT_MUTED }}>{unreadable}</p>}
          <button type="button" onClick={onBack} style={{ ...primaryButton(false), marginTop: 12 }}>Try another photo</button>
        </div>
      )}

      {rows.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED }}>
          {typed
            ? 'Type the details. Switch Text them off to keep a lead for yourself.'
            : `${rows.length === 1 ? 'Found 1 lead.' : `Found ${rows.length} leads.`} Check each one. A single wrong digit texts a stranger.`}
        </p>
      )}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {rows.map(row => (
          <CandidateCard key={row.index} sessionId={sessionId} row={row} disabled={sending} autoFocus={typed && row.index === rows.length - 1}
            onChange={patch => onRow(row.index, patch)} />
        ))}
      </div>

      {rows.length > 0 && (
        <button type="button" onClick={onAdd} disabled={sending} style={{ ...bigButton(false), fontSize: 14, padding: '10px 12px' }}>
          <Plus size={16} weight="bold" aria-hidden /> Add another
        </button>
      )}

      {rows.length > 0 && (
        <div style={{ background: BG_CARD, borderRadius: 16, padding: 16, boxShadow: CARD_SHADOW, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {opener && sample && (
            <div style={{ background: BG_SECTION, borderRadius: 12, padding: 12 }}>
              <div style={label}>What we will text {sample.name ? sample.name.split(/\s+/)[0] : 'them'}</div>
              <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.45 }}>
                {snapshotOpening(opener, { name: sample.name, service: sample.service })}
              </p>
            </div>
          )}

          {gate.send > 0 && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              <input
                type="checkbox" checked={consent} disabled={sending}
                onChange={e => onConsent(e.target.checked)}
                style={{ width: 20, height: 20, marginTop: 1, accentColor: brandVar }}
              />
              <span>These people asked us to contact them.</span>
            </label>
          )}

          <button type="button" onClick={onSend} disabled={!gate.ok || sending} style={primaryButton(!gate.ok || sending)}>
            <PaperPlaneTilt size={18} weight="bold" aria-hidden />
            {sending ? (gate.send > 0 ? 'Sending' : 'Saving') : sendLabel(gate.send, gate.save)}
          </button>
          {!gate.ok && <p style={{ margin: 0, fontSize: 12, color: TEXT_MUTED }}>{gate.reason}</p>}
          <button type="button" onClick={onBack} disabled={sending} style={{ ...bigButton(false), fontSize: 13, padding: '8px 12px' }}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateCard({ sessionId, row, disabled, autoFocus, onChange }: {
  sessionId: string; row: EditableRow; disabled: boolean; autoFocus?: boolean; onChange: (patch: Partial<EditableRow>) => void;
}) {
  const dup = row.duplicate;
  const locked = disabled || dup !== null;
  const muted = dup !== null || !row.include;
  const phoneBad = row.include && !dup && row.phone.trim() !== '' && !/^\+?[\d\s().-]{10,}$/.test(row.phone);
  const withheld = (f: 'name' | 'phone' | 'address') => row.withheld.includes(f);
  const state = dup ? 'Not sending' : !row.include ? 'Skipped' : row.text ? 'Sending' : 'Saving only';

  return (
    <div data-testid={`candidate-${row.index}`} style={{
      background: BG_CARD, borderRadius: 16, padding: 14, boxShadow: CARD_SHADOW,
      opacity: muted ? 0.72 : 1, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: dup ? 'default' : 'pointer' }}>
          <input
            type="checkbox" checked={row.include} disabled={locked}
            onChange={e => onChange({ include: e.target.checked })}
            aria-label={`Include lead ${row.index + 1}`}
            style={{ width: 18, height: 18, accentColor: brandVar }}
          />
          {state}
        </label>
        {dup ? (
          <span style={{ fontSize: 12, color: TEXT_MUTED, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {duplicateMessage(dup)}
            {dup.lead_id && (
              <Link href={`/dash/${sessionId}/pipeline?spotlight=${dup.lead_id}`} style={{ color: TEXT_DARK, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                Open <ArrowSquareOut size={13} aria-hidden />
              </Link>
            )}
          </span>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: row.text ? TEXT_DARK : TEXT_MUTED, cursor: 'pointer' }}>
            <input
              type="checkbox" role="switch" aria-checked={row.text} checked={row.text} disabled={locked || !row.include}
              onChange={e => onChange({ text: e.target.checked })}
              aria-label={`Text lead ${row.index + 1}`}
              style={{ width: 16, height: 16, accentColor: brandVar }}
            />
            Text them
          </label>
        )}
      </div>

      <Field label="Phone" hint={withheld('phone') ? 'Could not read this. Type it in.' : phoneBad ? 'That does not look like a number we can text.' : null}
        flag={withheld('phone') || phoneBad}>
        <input
          type="tel" inputMode="tel" value={row.phone} disabled={locked} autoFocus={autoFocus}
          onChange={e => onChange({ phone: e.target.value })}
          onBlur={() => onChange({ phone: displayPhone(row.phone) })}
          aria-label={`Phone for lead ${row.index + 1}`}
          style={{ ...input, fontSize: 22, fontFamily: FONT_NUM, letterSpacing: 0.5, fontWeight: 600 }}
          placeholder="(801) 555-1234"
        />
      </Field>
      <Field label="Name" hint={withheld('name') ? 'Could not read this.' : null} flag={withheld('name')}>
        <input type="text" value={row.name} disabled={locked} onChange={e => onChange({ name: e.target.value })}
          aria-label={`Name for lead ${row.index + 1}`} style={input} autoCapitalize="words" />
      </Field>
      <Field label="Address" hint={withheld('address') ? 'Could not read this.' : null} flag={withheld('address')}>
        <input type="text" value={row.address} disabled={locked} onChange={e => onChange({ address: e.target.value })}
          aria-label={`Address for lead ${row.index + 1}`} style={input} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Work wanted">
          <input type="text" value={row.service} disabled={locked} onChange={e => onChange({ service: e.target.value })}
            aria-label={`Work wanted for lead ${row.index + 1}`} style={input} placeholder="driveway" />
        </Field>
        <Field label="Notes">
          <input type="text" value={row.notes} disabled={locked} onChange={e => onChange({ notes: e.target.value })}
            aria-label={`Notes for lead ${row.index + 1}`} style={input} />
        </Field>
      </div>
    </div>
  );
}

function Field({ label: text, hint, flag, children }: { label: string; hint?: string | null; flag?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...label, color: flag ? SCORE_AMBER : TEXT_MUTED }}>{text}</span>
      <div style={{ borderRadius: 10, boxShadow: flag ? `0 0 0 2px ${SCORE_AMBER}` : 'none' }}>{children}</div>
      {hint && <span style={{ fontSize: 12, color: SCORE_AMBER }}>{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ResultStep({ sessionId, outcomes, hold, sendAfter, onAgain }: {
  sessionId: string; outcomes: Outcome[]; hold: boolean; sendAfter: string | null; onAgain: () => void;
}) {
  const sent = outcomes.filter(o => o.outcome === 'sent').length;
  const queued = outcomes.filter(o => o.outcome === 'queued').length;
  const saved = outcomes.filter(o => o.outcome === 'saved').length;
  const parts: string[] = [];
  if (queued > 0) parts.push(`${queued === 1 ? '1 text' : `${queued} texts`} queued${sendAfter ? ` until ${when(sendAfter)}` : ''}`);
  if (sent > 0) parts.push(`${sent === 1 ? '1 text' : `${sent} texts`} sent`);
  if (saved > 0) parts.push(`${saved === 1 ? '1 lead' : `${saved} leads`} saved for you`);
  const headline = parts.length === 0 ? 'Nothing was sent.' : parts.join(', ') + '.';

  return (
    <div style={{ background: BG_CARD, borderRadius: 16, padding: 16, boxShadow: CARD_SHADOW, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontFamily: FONT_HEAD, fontFeatureSettings: FONT_HEAD_FEATURE }}>
        {headline.charAt(0).toUpperCase() + headline.slice(1)}
      </h2>
      {hold && queued > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED }}>
          We do not text people overnight or on Sundays. They will hear from us first thing.
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {outcomes.map(o => (
          <li key={o.index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
            <OutcomeIcon outcome={o.outcome} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Lead {o.index + 1}: {o.message}</span>
              {o.lead_id && (o.outcome === 'sent' || o.outcome === 'queued' || o.outcome === 'saved') && (
                <Link href={`/dash/${sessionId}/pipeline?spotlight=${o.lead_id}`} style={{ fontSize: 13, color: TEXT_DARK, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {o.outcome === 'saved' ? 'Open the lead' : 'Open the conversation'} <ArrowSquareOut size={13} aria-hidden />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAgain} style={primaryButton(false)}>
        <Plus size={18} weight="bold" aria-hidden /> Add another
      </button>
      <Link href={`/dash/${sessionId}/pipeline`} style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center' }}>Back to the pipeline</Link>
    </div>
  );
}

function OutcomeIcon({ outcome }: { outcome: Outcome['outcome'] }) {
  const common = { size: 20, weight: 'fill' as const, 'aria-hidden': true, style: { flexShrink: 0, marginTop: 1 } };
  switch (outcome) {
    case 'sent': return <CheckCircle {...common} color={FREE_GREEN} />;
    case 'saved': return <CheckCircle {...common} color={TEXT_DARK} />;
    case 'queued': return <Clock {...common} color={SCORE_AMBER} />;
    case 'failed': return <XCircle {...common} color={SCORE_RED} />;
    case 'invalid': return <Warning {...common} color={SCORE_RED} />;
    default: return <MinusCircle {...common} color={TEXT_FAINT} />;
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'the next open hour';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
}

// ---------------------------------------------------------------------------

const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: TEXT_MUTED,
};

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${BORDER_SOFT}`, background: BG_SECTION, color: TEXT_DARK, fontSize: 15, fontFamily: FONT_BODY,
};

function bigButton(primaryish: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '16px 18px', borderRadius: 14, fontSize: 16, fontWeight: 700, fontFamily: FONT_BODY,
    border: primaryish ? 'none' : `1px solid ${BORDER_SOFT}`,
    background: primaryish ? TEXT_DARK : BG_SECTION, color: primaryish ? '#fff' : TEXT_DARK,
    cursor: 'pointer', width: '100%',
  };
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '14px 18px', borderRadius: 14, fontSize: 16, fontWeight: 700, fontFamily: FONT_BODY,
    border: 'none', background: brandVar, color: '#fff', width: '100%',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  };
}
