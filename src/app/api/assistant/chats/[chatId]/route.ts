import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { assertAssistantAccess } from '@/lib/assistant/access';

async function sessionForChat(chatId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('assistant_chats').select('session_id').eq('id', chatId).maybeSingle();
  return data?.session_id ?? null;
}

// GET /api/assistant/chats/[chatId]  -> messages, oldest first
export async function GET(_req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const sessionId = await sessionForChat(chatId);
  if (!sessionId) return NextResponse.json({ error: 'chat not found' }, { status: 404 });
  const denied = await assertAssistantAccess(sessionId);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('assistant_messages')
    .select('id, role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

// DELETE /api/assistant/chats/[chatId]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const sessionId = await sessionForChat(chatId);
  if (!sessionId) return NextResponse.json({ ok: true });
  const denied = await assertAssistantAccess(sessionId);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase.from('assistant_chats').delete().eq('id', chatId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
