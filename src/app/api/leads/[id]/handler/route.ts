import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { setHandler, type Handler } from '@/lib/agent/handler';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: string; handler?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (body.handler !== 'agent' && body.handler !== 'human') {
    return NextResponse.json({ error: 'handler must be agent|human' }, { status: 400 });
  }
  const { error } = await setHandler(createServiceClient(), {
    leadId: id, sessionId: body.session_id, handler: body.handler as Handler, by: 'dashboard',
  });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
