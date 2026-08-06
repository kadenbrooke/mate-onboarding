// src/lib/metrics/speed.ts
import type { Lead } from './leads';

// ---------------------------------------------------------------------------
// Time-of-day distribution for the "When Leads Arrive" bar chart. Buckets
// hourCounts (24 hourly slots, from speedStats below) into 3-hour windows so
// the busiest window is scannable at a glance instead of 24 skinny bars.
// ---------------------------------------------------------------------------

export type TimeBucket = { startHour: number; label: string; count: number };

/** "12a" / "9a" / "12p" / "9p" -- short enough to sit under a narrow bar. */
export function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'a' : 'p'}`;
}

export function hourBuckets(hourCounts: number[]): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  for (let start = 0; start < 24; start += 3) {
    const count = hourCounts.slice(start, start + 3).reduce((a, b) => a + b, 0);
    buckets.push({ startHour: start, label: hourLabel(start), count });
  }
  return buckets;
}

/** "9a-6p" range label for the busiest 3-hour window, or null with no data. */
export function peakBucketRange(buckets: TimeBucket[]): string | null {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  if (total === 0) return null;
  const peak = buckets.reduce((max, b) => (b.count > max.count ? b : max), buckets[0]);
  return `${hourLabel(peak.startHour)}-${hourLabel((peak.startHour + 3) % 24)}`;
}

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
  // 'call' covers the answered-call-notify-operator path; 'missed_call' is the
  // pre-2026-08-05 name for the same bucket, kept for any still-unmigrated rows.
  const rescued = leads.filter(l => l.source === 'call' || l.source === 'missed_call').length;
  return {
    avgReplySeconds, afterHoursCount, hourCounts, streakDays,
    rescued, missedTotal: Math.max(totalMissedCalls ?? rescued, rescued),
  };
}
