import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { assertAssistantAccess } from '@/lib/assistant/access';

// GET /api/assistant/chats?session_id=...  -> list chats for the session
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  const denied = await assertAssistantAccess(sessionId);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('assistant_chats')
    .select('id, title, updated_at')
    .eq('session_id', sessionId)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chats: data ?? [] });
}

// POST /api/assistant/chats  { session_id }  -> create an empty chat
export async function POST(request: NextRequest) {
  let body: { session_id?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  const denied = await assertAssistantAccess(body.session_id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('assistant_chats')
    .insert({ session_id: body.session_id })
    .select('id, title, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chat: data });
}
