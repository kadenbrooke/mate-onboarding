import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/agent/telnyx';
import { setHandler } from '@/lib/agent/handler';
import { logMessage } from '@/lib/agent/messages';

// Human reply from the dashboard: send to the lead, log it, and auto-take-over
// (typing = takeover). Session UUID doubles as the bearer (portal trust model).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: string; text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: lead } = await supabase.from('client_leads')
    .select('phone').eq('id', id).eq('session_id', body.session_id).single();
  if (!lead?.phone) return NextResponse.json({ error: 'lead not found or has no phone' }, { status: 404 });

  const sent = await sendSms(lead.phone, text);
  if (!sent.ok) return NextResponse.json({ error: sent.error ?? 'send failed' }, { status: 502 });

  await logMessage(supabase, { leadId: id, sessionId: body.session_id, direction: 'outbound', author: 'human', body: text });
  await setHandler(supabase, { leadId: id, sessionId: body.session_id, handler: 'human', by: 'dashboard' });
  return NextResponse.json({ ok: true });
}
