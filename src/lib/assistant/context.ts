import type { Lead } from '@/lib/metrics/leads';
import { pipelineTotals, sourceBreakdown } from '@/lib/metrics/leads';
import { revenueRowsFromLeads, summarizeReturn } from '@/lib/metrics/revenue';
import { SOURCE_LABELS } from '@/lib/metrics/colors';

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/** Build the system prompt for the client assistant: identity + a compact,
 *  factual snapshot of THIS session's live lead data. Kept short so it fits
 *  cheaply in every turn. Pure — unit tested. */
export function buildAssistantContext(leads: Lead[], businessName: string | null, now = new Date()): string {
  const name = businessName?.trim() || 'your business';
  const totals = pipelineTotals(leads);
  const replies = leads.map(l => l.first_reply_seconds).filter((s): s is number => s != null);
  const avgReply = replies.length
    ? Math.round(replies.reduce((a, s) => a + s, 0) / replies.length)
    : null;
  const sources = sourceBreakdown(leads).segments
    .map(s => `${s.count} ${s.source.replaceAll('_', ' ')}`).join(', ') || 'none yet';

  // Return by lead source, from the job outcomes the client enters (migration
  // 0021). Only sources with an outcome are listed, to keep the prompt short.
  // The partner revenue-share estimate is deliberately left out: it is a draft
  // agreement figure, not something the assistant should quote to the owner.
  const returns = summarizeReturn(revenueRowsFromLeads(leads, now));
  const returnLine = returns.hasOutcomes
    ? `- Return by lead source (jobs marked won or lost by the team): ${returns.rows
        .filter(r => r.won > 0 || r.lost > 0)
        .map(r => `${SOURCE_LABELS[r.source] ?? r.source.replaceAll('_', ' ')}: ${r.won} won, ${r.lost} lost of ${r.leads} leads, ${dollars(r.job_value_cents)} sold, ${dollars(r.collected_cents)} collected`)
        .join('; ')}.`
    : `- Return by lead source: no jobs have been marked won or lost yet.`;

  const lines = [
    `You are the AI assistant inside the Auto Mate dashboard for ${name}.`,
    `You help the owner understand their leads and performance. Be concise, plain-spoken, and practical.`,
    `Answer ONLY from the data below and general small-business advice. If the data does not contain the answer, say so plainly — never invent numbers.`,
    ``,
    `LIVE DATA SNAPSHOT (their real numbers right now):`,
    `- ${leads.length} total leads (${totals.counts.open} open, ${totals.counts.booked} booked for an estimate, ${totals.counts.quoted} quoted, ${totals.counts.serviced} serviced).`,
    `- Service rate: ${totals.serviceRate}% of leads that got past open were serviced.`,
    `- Revenue from serviced jobs: ${dollars(totals.cents.serviced)}. Still in the pipeline: ${dollars(totals.cents.open + totals.cents.booked + totals.cents.quoted)}.`,
    `- Lead sources: ${sources}.`,
    returnLine,
    avgReply != null ? `- Average first-reply time: ${avgReply} seconds.` : `- First-reply time: not enough data yet.`,
  ];
  return lines.join('\n');
}
