// src/lib/metrics/speed.ts
import type { Lead } from './leads';

export function speedStats(leads: Lead[], totalMissedCalls?: number) {
  const replied = leads.filter(l => l.first_reply_seconds != null);
  const avgReplySeconds = replied.length
    ? Math.round(replied.reduce((a, l) => a + l.first_reply_seconds!, 0) / replied.length)
    : 0;
  const afterHoursCount = leads.filter(l => l.after_hours).length;
  const hourCounts = new Array(24).fill(0) as number[];
  for (const l of leads) hourCounts[new Date(l.created_at).getHours()]++;
  const dayAge = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  const unanswered = leads.filter(l => l.first_reply_seconds == null);
  const streakDays = leads.length === 0 ? 0
    : unanswered.length
      ? Math.min(...unanswered.map(l => dayAge(l.created_at)))
      : Math.max(...leads.map(l => dayAge(l.created_at)));
  const rescued = leads.filter(l => l.source === 'missed_call').length;
  return {
    avgReplySeconds, afterHoursCount, hourCounts, streakDays,
    rescued, missedTotal: Math.max(totalMissedCalls ?? rescued, rescued),
  };
}
