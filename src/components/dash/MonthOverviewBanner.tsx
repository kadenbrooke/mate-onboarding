'use client';
import {
  Wrench, UsersThree, Phone, Timer, Star, Target, ArrowUpRight, ArrowDownRight,
} from '@phosphor-icons/react';
import { useCountUp } from './useCountUp';
import { FONT_BODY, NUM_DISPLAY } from '@/lib/theme';
import { moneyShort } from '@/lib/metrics/format';
import type { MonthOverview } from '@/lib/metrics/monthOverview';
import type { Reputation } from './types';
import type { AdTotals } from '@/lib/metrics/ads';

// Sits above the Hero strip: the "CEO glance" zone. Six stats that cover the
// questions an owner actually asks in the first 30 seconds -- are we busy,
// are we fast, are we winning the jobs we quote, are customers happy. No
// revenue headline here: the dark Recovered card directly below already
// owns that number, so this stays the activity/speed/reputation summary
// instead of repeating it.

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function TrendPill({ pct, betterWhen = 'up' }: { pct: number; betterWhen?: 'up' | 'down' }) {
  const up = pct >= 0;
  const good = betterWhen === 'up' ? up : !up;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
      fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
      background: good ? 'rgba(255,255,255,0.22)' : 'rgba(20,20,20,0.22)',
      borderRadius: 99, padding: '3px 8px',
    }}>
      <Arrow size={11} weight="bold" aria-hidden />
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function StatTile({ icon, label, big, sub, trend }: {
  icon: React.ReactNode; label: string; big: React.ReactNode; sub?: string;
  trend?: { pct: number; betterWhen?: 'up' | 'down' };
}) {
  return (
    <div style={{
      minWidth: 0, background: 'rgba(255,255,255,0.14)', borderRadius: 14,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        {/* Short, whole-word labels that WRAP instead of truncating: a
            2-word eyebrow ("NEW LEADS") stays on one line on any screen
            wide enough for the tile itself; anything longer wraps to a
            second line rather than clipping mid-word. */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10.5,
          letterSpacing: 0.5, fontWeight: 600, fontFamily: FONT_BODY, opacity: 0.85,
          lineHeight: 1.25, minWidth: 0,
        }}>
          <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>{icon}</span>
          <span>{label}</span>
        </div>
        {trend && <TrendPill pct={trend.pct} betterWhen={trend.betterWhen} />}
      </div>
      <div style={{ fontSize: 24, marginTop: 8, lineHeight: 1, ...NUM_DISPLAY }}>{big}</div>
      {sub && (
        <div style={{ fontSize: 10.5, fontFamily: FONT_BODY, marginTop: 4, opacity: 0.75 }}>{sub}</div>
      )}
    </div>
  );
}

function CountedNumber({ value }: { value: number }) {
  const n = useCountUp(value, 900);
  return <>{Math.round(n)}</>;
}

export function MonthOverviewBanner({ overview, reputation, ads }: {
  overview: MonthOverview;
  reputation: Reputation | null;
  ads: AdTotals | null;
}) {
  return (
    <div style={{
      borderRadius: 24, padding: '20px 20px 20px', color: '#fff',
      background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, white 28%), var(--brand-primary, #e14d1a) 55%, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, black 22%))',
      boxShadow: '0 12px 28px color-mix(in srgb, var(--brand-primary, #e14d1a) 38%, transparent)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 11, letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_BODY, opacity: 0.85,
        }}>
          MONTH OVERVIEW
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_BODY, opacity: 0.85 }}>
          {overview.monthLabel}
        </span>
      </div>

      {/* Six supporting stats: activity, speed, reputation, ad efficiency */}
      <style>{`
        @media (max-width: 640px) {
          .month-overview-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
      <div className="month-overview-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14,
      }}>
        <StatTile
          icon={<Wrench size={13} weight="bold" />}
          label="JOBS COMPLETED"
          big={<CountedNumber value={overview.jobsCompleted.value} />}
          trend={{ pct: overview.jobsCompleted.pct }}
        />
        <StatTile
          icon={<UsersThree size={13} weight="bold" />}
          label="NEW LEADS"
          big={<CountedNumber value={overview.leadsAcquired.value} />}
          trend={{ pct: overview.leadsAcquired.pct }}
        />
        <StatTile
          icon={<Phone size={13} weight="bold" />}
          label="CALLS HANDLED"
          big={<CountedNumber value={overview.callsHandled.value} />}
          trend={{ pct: overview.callsHandled.pct }}
        />
        <StatTile
          icon={<Timer size={13} weight="bold" />}
          label="AVG RESPONSE"
          big={fmtDuration(overview.avgResponseSeconds.value)}
          trend={{ pct: overview.avgResponseSeconds.pct, betterWhen: 'down' }}
        />
        <StatTile
          icon={<Star size={13} weight="fill" />}
          label="RATING"
          big={reputation?.avg_rating ? reputation.avg_rating.toFixed(1) : '--'}
          sub={reputation ? `${reputation.on_google} reviews` : 'no data yet'}
        />
        <StatTile
          icon={<Target size={13} weight="bold" />}
          label="COST / LEAD"
          big={ads ? moneyShort(ads.cpl_cents) : '--'}
          sub={ads ? `${ads.leads} leads from ads` : 'ads not connected'}
        />
      </div>
    </div>
  );
}
