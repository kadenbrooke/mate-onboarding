import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refuseIfWritesDisabled } from '@/lib/supabase/write-gate';
import { unservedSessionResponse } from '@/lib/supabase/tenant-response';
import { sendSms } from '@/lib/agent/telnyx';
import { runQuoteMenuScan } from '@/lib/agent/quoteOutcome';
import { isWithinSendWindow, type QuietHours } from '@/lib/agent/quietHours';
import { logMessage } from '@/lib/agent/messages';
import { fakePracticeMessage } from '@/lib/portal/practice';

export const runtime = 'nodejs';

// Trigger for the J&C quote-outcome menu (cultivator-spec.md Piece 3). Scheduled
// (n8n Schedule Trigger -> this route). Opens a menu once a quote appointment has
// ended, and re-sends due choice-4 re-asks. Auth = the same shared token as the
// post-call route. Stub-safe: with no J&C session configured it opens nothing.
function authed(params: URLSearchParams): boolean {
  const tok = process.env.AGENT_WEBHOOK_TOKEN;
  return !!tok && params.get('k') === tok;
}

// J&C sending window (America/Denver, business hours, no Sundays). cal.com owns
// appointment reminders; this window only gates the operator menu to Jeffrey.
const JC_QUIET_HOURS: QuietHours = { tz: 'America/Denver', start: '08:00', end: '20:00', skip_days: [0] };

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!authed(params)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const writesOff = refuseIfWritesDisabled();
  if (writesOff) return writesOff;

  const sessionId = process.env.JC_ONBOARDING_SESSION_ID;
  if (!sessionId) {
    return NextResponse.json({ ok: true, opened: 0, reasked: 0, skipped: 'JC_ONBOARDING_SESSION_ID unset' });
  }
  const unserved = unservedSessionResponse(request, sessionId);
  if (unserved) return unserved;

  const supabase = createServiceClient();
  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('operator_phone, is_practice')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!session?.operator_phone) {
    return NextResponse.json({ ok: true, opened: 0, reasked: 0, skipped: 'no operator_phone' });
  }

  const provider = session.is_practice
    ? async () => ({ ok: true, practice: true })
    : sendSms;
  const onPracticeSend = session.is_practice
    ? async (text: string, conversationId: string | null) => {
        if (!conversationId) return;
        const { data: lead } = await supabase.from('client_leads')
          .select('id').eq('session_id', sessionId).eq('phone', conversationId).maybeSingle();
        if (!lead?.id) return;
        await logMessage(supabase, {
          leadId: lead.id as string,
          sessionId,
          direction: 'outbound',
          author: 'system',
          channel: 'system',
          body: fakePracticeMessage(text, 'office'),
        });
      }
    : undefined;
  const result = await runQuoteMenuScan({
    supabase,
    sendSms: provider,
    sessionId,
    operatorPhone: session.operator_phone,
    onPracticeSend,
    withinWindow: isWithinSendWindow(JC_QUIET_HOURS),
  });
  return NextResponse.json({ ok: true, practice: session.is_practice === true, ...result });
}
