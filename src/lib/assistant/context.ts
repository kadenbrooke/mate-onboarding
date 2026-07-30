import type { Lead } from '@/lib/metrics/leads';
import { pipelineTotals, sourceBreakdown } from '@/lib/metrics/leads';

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/** Build the system prompt for the client assistant: identity + a compact,
 *  factual snapshot of THIS session's live lead data. Kept short so it fits
 *  cheaply in every turn. Pure — unit tested. */
export function buildAssistantContext(leads: Lead[], businessName: string | null): string {
  const name = businessName?.trim() || 'your business';
  const totals = pipelineTotals(leads);
  const replies = leads.map(l => l.first_reply_seconds).filter((s): s is number => s != null);
  const avgReply = replies.length
    ? Math.round(replies.reduce((a, s) => a + s, 0) / replies.length)
    : null;
  const sources = sourceBreakdown(leads).segments
    .map(s => `${s.count} ${s.source.replaceAll('_', ' ')}`).join(', ') || 'none yet';

  const lines = [
    `You are the AI assistant inside the Auto Mate dashboard for ${name}.`,
    `You help the owner understand their leads and performance. Be concise, plain-spoken, and practical.`,
    `Answer ONLY from the data below and general small-business advice. If the data does not contain the answer, say so plainly — never invent numbers.`,
    ``,
    `LIVE DATA SNAPSHOT (their real numbers right now):`,
    `- ${leads.length} total leads (${totals.counts.won} won, ${totals.counts.lost} lost, ${totals.counts.open} open).`,
    `- Win rate: ${totals.winRate}% of settled leads.`,
    `- Revenue won: ${dollars(totals.wonCents)}. Open pipeline value: ${dollars(totals.openCents)}.`,
    `- Lead sources: ${sources}.`,
    avgReply != null ? `- Average first-reply time: ${avgReply} seconds.` : `- First-reply time: not enough data yet.`,
  ];
  return lines.join('\n');
}
