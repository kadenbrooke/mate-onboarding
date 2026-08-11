'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from '@phosphor-icons/react';
import type { LeadMessage } from '@/lib/agent/messages';
import { BG_CARD, BORDER_SOFT, FONT_BODY, TEXT_DARK, TEXT_MUTED } from '@/lib/theme';

// The lead's conversation, opened by clicking a row in the pipeline table
// (which sets ?spotlight=<leadId>).
//
// The thread renders ABOVE the table, and a row click is a SOFT navigation:
// the table's client component is not remounted, so nothing scrolls on its
// own. An operator who clicked a row 30 rows down was left staring at an
// unchanged viewport while the thread quietly appeared off-screen above them,
// which read as "clicking a row does nothing". Hence the scroll-into-view keyed
// on leadId: it fires on first open AND on every switch to a different lead.

const AUTHOR_LABEL: Record<LeadMessage['author'], string> = {
  lead: 'Lead', agent: 'Mate', human: 'You', system: 'System',
};

export function LeadThread({ leadId, sessionId, handler, messages, leadName }: {
  leadId: string; sessionId: string; handler: 'agent' | 'human'; messages: LeadMessage[];
  leadName?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [driver, setDriver] = useState(handler);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const who = leadName?.trim() || 'this lead';

  useEffect(() => {
    // Re-runs whenever a different lead is spotlighted, not just on mount.
    const el = rootRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Driver state is per-lead: switching leads must not carry the previous
    // lead's optimistic handler across.
    setDriver(handler);
    setText('');
  }, [leadId, handler]);

  function close() {
    router.push(`/dash/${sessionId}/pipeline`);
  }

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/leads/${leadId}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, text }),
    });
    // Only clear the draft + flip the driver to You when the send actually landed.
    if (res.ok) { setText(''); setDriver('human'); }
    setBusy(false);
  }
  async function toggle(next: 'agent' | 'human') {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/leads/${leadId}/handler`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, handler: next }),
    });
    // Only reflect the handler change locally if the PATCH succeeded.
    if (res.ok) setDriver(next);
    setBusy(false);
  }

  return (
    <div ref={rootRef} data-testid="lead-thread" data-lead-id={leadId}
      style={{ background: BG_CARD, borderRadius: 12, padding: 12 }}>
      {/* Whose thread this is, and the way back out. Without a name the panel
          was anonymous, and without a close control the only way back to the
          plain table was editing the URL. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${BORDER_SOFT}`,
      }}>
        <span style={{ color: TEXT_DARK, fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY }}>
          {who}
        </span>
        <button type="button" onClick={close} aria-label={`Close conversation with ${who}`}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: TEXT_MUTED, display: 'inline-flex', padding: 4,
          }}>
          <X size={15} weight="bold" aria-hidden />
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>Driver: {driver === 'agent' ? 'Mate' : 'You'}</span>
        {driver === 'agent'
          ? <button onClick={() => toggle('human')} disabled={busy}>Take over</button>
          : <button onClick={() => toggle('agent')} disabled={busy}>Hand back to Mate</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {messages.length === 0 && (
          <div style={{ color: TEXT_MUTED, fontSize: 13, fontFamily: FONT_BODY, padding: '8px 0' }}>
            No messages with {who} yet.
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{ fontSize: 11, color: TEXT_MUTED }}>{AUTHOR_LABEL[m.author]}{m.channel === 'call_note' ? ' (call note)' : ''}</div>
            <div style={{ color: TEXT_DARK, fontSize: 14 }}>{m.body}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type a reply"
          onKeyDown={e => { if (e.key === 'Enter') send(); }} style={{ flex: 1 }} />
        <button onClick={send} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
