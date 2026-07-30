'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PaperPlaneRight, Plus, Copy, Check, Stop, Sparkle,
} from '@phosphor-icons/react';
import {
  BG_CARD, BG_PAGE, BORDER_SOFT, TEXT_DARK, TEXT_MUTED, FONT_BODY, CARD_SHADOW, brandVar,
} from '@/lib/theme';

type Role = 'user' | 'assistant';
interface Msg { id: string; role: Role; content: string }
interface ChatMeta { id: string; title: string; updated_at: string }

const SUGGESTIONS = [
  'How are my leads doing?',
  'Who should I call first?',
  'How much revenue did I win this month?',
  "What's my response time?",
];

export function AssistantView({ sessionId }: { sessionId: string }) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    const res = await fetch(`/api/assistant/chats?session_id=${sessionId}`);
    if (res.ok) setChats((await res.json()).chats ?? []);
  }, [sessionId]);

  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function openChat(id: string) {
    setChatId(id);
    const res = await fetch(`/api/assistant/chats/${id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages((data.messages ?? []).map((m: Msg) => ({ id: m.id, role: m.role, content: m.content })));
    }
  }

  function newChat() {
    setChatId(null);
    setMessages([]);
    setInput('');
  }

  async function ensureChat(): Promise<string | null> {
    if (chatId) return chatId;
    const res = await fetch('/api/assistant/chats', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) return null;
    const id = (await res.json()).chat?.id as string;
    setChatId(id);
    return id;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    const id = await ensureChat();
    if (!id) return;
    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content };
    const aId = `a-${Date.now()}`;
    setMessages(m => [...m, userMsg, { id: aId, role: 'assistant', content: '' }]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, chat_id: id, content }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error('stream failed');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          try {
            const { delta } = JSON.parse(t.slice(5).trim()) as { delta?: string };
            if (delta) setMessages(m => m.map(x => x.id === aId ? { ...x, content: x.content + delta } : x));
          } catch { /* ignore */ }
        }
      }
    } catch {
      setMessages(m => m.map(x => x.id === aId && !x.content
        ? { ...x, content: 'Sorry — I could not reach the assistant. Try again.' } : x));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void loadChats();
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  async function copy(m: Msg) {
    try { await navigator.clipboard.writeText(m.content); setCopiedId(m.id); setTimeout(() => setCopiedId(null), 1200); }
    catch { /* ignore */ }
  }

  const empty = messages.length === 0;

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 160px)', minHeight: 420 }}>
      <aside className="assistant-rail" style={{
        width: 220, flexShrink: 0, background: BG_CARD, borderRadius: 16,
        boxShadow: CARD_SHADOW, padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <button type="button" onClick={newChat} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          border: `1px solid ${BORDER_SOFT}`, background: 'transparent', borderRadius: 10,
          padding: '9px 12px', cursor: 'pointer', color: TEXT_DARK, fontFamily: FONT_BODY,
          fontSize: 13, fontWeight: 600,
        }}>
          <Plus size={15} /> New chat
        </button>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {chats.map(c => (
            <button key={c.id} type="button" onClick={() => openChat(c.id)} style={{
              textAlign: 'left', border: 'none', background: c.id === chatId ? BG_PAGE : 'transparent',
              borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: TEXT_DARK,
              fontFamily: FONT_BODY, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      <section style={{
        flex: 1, minWidth: 0, background: BG_CARD, borderRadius: 16, boxShadow: CARD_SHADOW,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <style>{`@media (max-width: 640px) { .assistant-rail { display: none !important; } }`}</style>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {empty ? (
            <div style={{ maxWidth: 560, margin: '32px auto 0', textAlign: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', margin: '0 auto 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: brandVar, color: '#fff',
              }}><Sparkle size={24} weight="fill" /></div>
              <h2 style={{ fontFamily: FONT_BODY, fontSize: 18, color: TEXT_DARK, margin: '0 0 6px' }}>
                Ask about your business
              </h2>
              <p style={{ fontFamily: FONT_BODY, fontSize: 13, color: TEXT_MUTED, margin: '0 0 20px' }}>
                Your assistant can see your live leads, revenue, and response times.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} type="button" onClick={() => send(s)} style={{
                    border: `1px solid ${BORDER_SOFT}`, background: 'transparent', borderRadius: 12,
                    padding: '12px 14px', cursor: 'pointer', color: TEXT_DARK, fontFamily: FONT_BODY,
                    fontSize: 13, textAlign: 'left',
                  }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720, margin: '0 auto' }}>
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 14,
                      padding: '10px 14px', fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.5,
                      background: m.role === 'user' ? brandVar : BG_PAGE,
                      color: m.role === 'user' ? '#fff' : TEXT_DARK,
                    }}>
                      {m.content || (streaming ? '…' : '')}
                    </div>
                    {m.role === 'assistant' && m.content && (
                      <button type="button" onClick={() => copy(m)} aria-label="Copy" style={{
                        alignSelf: 'flex-start', border: 'none', background: 'transparent', cursor: 'pointer',
                        color: TEXT_MUTED, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                        fontFamily: FONT_BODY, padding: '2px 4px',
                      }}>
                        {copiedId === m.id ? <Check size={13} /> : <Copy size={13} />}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={e => { e.preventDefault(); void send(input); }} style={{
          borderTop: `1px solid ${BORDER_SOFT}`, padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <textarea
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder="Ask about your leads…" rows={1} aria-label="Message"
            style={{
              flex: 1, resize: 'none', maxHeight: 140, border: `1px solid ${BORDER_SOFT}`,
              borderRadius: 12, padding: '10px 12px', fontFamily: FONT_BODY, fontSize: 14,
              color: TEXT_DARK, outline: 'none', background: BG_PAGE,
            }}
          />
          {streaming ? (
            <button type="button" onClick={stop} aria-label="Stop" style={btnStyle}>
              <Stop size={18} weight="fill" />
            </button>
          ) : (
            <button type="submit" aria-label="Send" disabled={!input.trim()} style={{ ...btnStyle, opacity: input.trim() ? 1 : 0.4 }}>
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 42, height: 42, flexShrink: 0, borderRadius: 12, border: 'none', cursor: 'pointer',
  background: brandVar, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
