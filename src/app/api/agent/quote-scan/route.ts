import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/agent/telnyx';
import { runQuoteMenuScan } from '@/lib/agent/quoteOutcome';
import { isWithinSendWindow, type QuietHours } from '@/lib/agent/quietHours';

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

  const sessionId = process.env.JC_ONBOARDING_SESSION_ID;
  if (!sessionId) {
    return NextResponse.json({ ok: true, opened: 0, reasked: 0, skipped: 'JC_ONBOARDING_SESSION_ID unset' });
  }

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('operator_phone')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session?.operator_phone) {
    return NextResponse.json({ ok: true, opened: 0, reasked: 0, skipped: 'no operator_phone' });
  }

  const result = await runQuoteMenuScan({
    supabase,
    sendSms,
    sessionId,
    operatorPhone: session.operator_phone,
    withinWindow: isWithinSendWindow(JC_QUIET_HOURS),
  });
  return NextResponse.json({ ok: true, ...result });
}
