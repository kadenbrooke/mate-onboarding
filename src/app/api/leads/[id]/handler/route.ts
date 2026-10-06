import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { setHandler, type Handler } from '@/lib/agent/handler';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';

// Flipping the handler changes whether the First Responder answers this lead,
// so it is gated on access to the lead's tenant (derived from the lead row).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: string; handler?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (body.handler !== 'agent' && body.handler !== 'human') {
    return NextResponse.json({ error: 'handler must be agent|human' }, { status: 400 });
  }

  const gate = await checkLeadApiAccess(id, body.session_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { error } = await setHandler(createServiceClient(), {
    leadId: id, sessionId: gate.lead.session_id, handler: body.handler as Handler, by: 'dashboard',
  });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
