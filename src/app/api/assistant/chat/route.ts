import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { assertAssistantAccess } from '@/lib/assistant/access';
import { buildAssistantContext } from '@/lib/assistant/context';
import { portkeyChatStream, type ChatMessage } from '@/lib/demo/portkey';
import type { Lead } from '@/lib/metrics/leads';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/assistant/chat  { session_id, chat_id, content }
// Streams the assistant reply as SSE `data: <text delta>` lines, then persists
// the user message and the full assistant reply.
export async function POST(request: NextRequest) {
  let body: { session_id?: string; chat_id?: string; content?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const { session_id, chat_id, content } = body;
  if (!session_id || !chat_id || !content?.trim()) {
    return NextResponse.json({ error: 'session_id, chat_id, content required' }, { status: 400 });
  }
  const denied = await assertAssistantAccess(session_id);
  if (denied) return denied;

  const supabase = createServiceClient();

  // Tenant isolation: the chat must belong to THIS session. Demo sessions are
  // public, so without this guard a caller could pass a known demo session_id
  // plus another tenant's chat_id and read/write that tenant's conversation.
  const { data: owner } = await supabase
    .from('assistant_chats').select('session_id').eq('id', chat_id).maybeSingle();
  if (!owner || owner.session_id !== session_id) {
    return NextResponse.json({ error: 'chat not found' }, { status: 404 });
  }

  const [{ data: session }, { data: leadsData }, { data: history }] = await Promise.all([
    supabase.from('onboarding_sessions').select('collected').eq('id', session_id).maybeSingle(),
    supabase.from('client_leads').select('*').eq('session_id', session_id).limit(500),
    supabase.from('assistant_messages').select('role, content').eq('chat_id', chat_id)
      .order('created_at', { ascending: true }).limit(40),
  ]);

  let businessName: string | null = null;
  const collected = session?.collected as Record<string, unknown> | undefined;
  const company = collected?.company as { name?: string } | undefined;
  if (company?.name) businessName = company.name;

  const system = buildAssistantContext((leadsData ?? []) as Lead[], businessName);
  const priorMsgs: ChatMessage[] = (history ?? []).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const messages: ChatMessage[] = [...priorMsgs, { role: 'user', content: content.trim() }];

  await supabase.from('assistant_messages').insert({ chat_id, role: 'user', content: content.trim() });
  if (priorMsgs.length === 0) {
    const title = content.trim().slice(0, 60);
    await supabase.from('assistant_chats').update({ title, updated_at: new Date().toISOString() }).eq('id', chat_id);
  } else {
    await supabase.from('assistant_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat_id);
  }

  const upstream = await portkeyChatStream({ system, messages, taskClass: 'assistant' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'assistant unavailable' }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let full = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
              }
            } catch { /* ignore keep-alives / partial json */ }
          }
        }
      } finally {
        if (full.trim()) {
          await supabase.from('assistant_messages').insert({ chat_id, role: 'assistant', content: full.trim() });
        }
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
