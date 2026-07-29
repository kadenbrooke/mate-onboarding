'use client';
import { useState } from 'react';
import type { LeadMessage } from '@/lib/agent/messages';
import { BG_CARD, TEXT_DARK, TEXT_MUTED } from '@/lib/theme';

const AUTHOR_LABEL: Record<LeadMessage['author'], string> = {
  lead: 'Lead', agent: 'Mate', human: 'You', system: 'System',
};

export function LeadThread({ leadId, sessionId, handler, messages }: {
  leadId: string; sessionId: string; handler: 'agent' | 'human'; messages: LeadMessage[];
}) {
  const [text, setText] = useState('');
  const [driver, setDriver] = useState(handler);
  const [busy, setBusy] = useState(false);

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
    <div style={{ background: BG_CARD, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>Driver: {driver === 'agent' ? 'Mate' : 'You'}</span>
        {driver === 'agent'
          ? <button onClick={() => toggle('human')} disabled={busy}>Take over</button>
          : <button onClick={() => toggle('agent')} disabled={busy}>Hand back to Mate</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
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
