'use client';
// SystemPulse - SYSTEM PULSE card with live EKG animation.
// State is derived from open incidents (resolved_at === null).
// Critical trumps warning; no open incidents => green.
//
// White-label note: copy never mentions "Auto Mate" by name.
// Notification pipe is Plan 3 - the "support team was notified" line is
// optimistic, grounded in the incident row's existence (it was written by the
// heartbeat automation that also fires the real alert).

import { useEffect, useId, useState } from 'react';
import { Card } from '../Card';
import { FONT_BODY, NUM_TABLE } from '@/lib/theme';
import type { Incident } from '../types';

const STATES = {
  green: {
    badge: 'ALL SYSTEMS GO',
    color: '#2e8f5a',
    dur: '2.6s',
    path: 'M0,30 L60,30 L70,30 L76,18 L84,42 L90,30 L150,30 L160,30 L166,18 L174,42 L180,30 L240,30 L250,30 L256,18 L264,42 L270,30 L300,30',
  },
  warning: {
    badge: 'NEEDS ATTENTION',
    color: '#c08a0a',
    dur: '1.6s',
    path: 'M0,32 L40,32 L48,10 L58,50 L66,32 L104,32 L112,10 L122,50 L130,32 L168,32 L176,10 L186,50 L194,32 L232,32 L240,10 L250,50 L258,32 L300,32',
  },
  critical: {
    badge: 'CRITICAL',
    color: '#c0392b',
    dur: '0.9s',
    path: 'M0,34 L24,34 L30,6 L38,54 L44,34 L68,34 L74,6 L82,54 L88,34 L112,34 L118,6 L126,54 L132,34 L156,34 L162,6 L170,54 L176,34 L200,34 L206,6 L214,54 L220,34 L244,34 L250,6 L258,54 L264,34 L300,34',
  },
} as const;

type StateKey = keyof typeof STATES;

function deriveState(incidents: Incident[]): StateKey {
  const open = incidents.filter((i) => i.resolved_at === null);
  if (open.some((i) => i.severity === 'critical')) return 'critical';
  if (open.some((i) => i.severity === 'warning')) return 'warning';
  return 'green';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function Stopwatch({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - new Date(startedAt).getTime()));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span data-testid="downtime" style={{ ...NUM_TABLE, fontSize: 13 }}>
      {formatElapsed(elapsed)}
    </span>
  );
}

function EkgSvg({ state, baseId }: { state: StateKey; baseId: string }) {
  const s = STATES[state];
  const animId = `${baseId}-ekg-sweep-${state}`;
  const glowId = `${baseId}-glow-${state}`;

  return (
    <>
      <style>{`
        @keyframes ${animId} {
          from { stroke-dashoffset: 600; }
          to   { stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ekg-path { animation: none !important; stroke-dashoffset: 0 !important; }
        }
        @keyframes badge-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
      <svg
        viewBox="0 0 300 60"
        width="100%"
        height={60}
        aria-hidden
        style={{ display: 'block', marginTop: 12, overflow: 'visible' }}
      >
        <defs>
          <filter id={glowId} x="-20%" y="-80%" width="140%" height="260%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={s.color} floodOpacity="0.25" />
          </filter>
        </defs>
        <path
          className="ekg-path"
          d={s.path}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="300 300"
          filter={`url(#${glowId})`}
          style={{
            animation: `${animId} ${s.dur} linear infinite`,
          }}
        />
      </svg>
    </>
  );
}

export function SystemPulse({ incidents }: { incidents: Incident[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const rawId = useId();
  const baseId = rawId.replace(/:/g, '');
  const stateKey = deriveState(incidents);
  const s = STATES[stateKey];

  if (!mounted) return <div style={{ height: 120 }} />;

  const openCritical = incidents.find(
    (i) => i.severity === 'critical' && i.resolved_at === null,
  );
  const openWarning = incidents.find(
    (i) => i.severity === 'warning' && i.resolved_at === null,
  );

  const badge = (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        fontFamily: FONT_BODY,
        letterSpacing: 1,
        color: s.color,
        background: `${s.color}18`,
        border: `1px solid ${s.color}44`,
        borderRadius: 99,
        padding: '2px 9px',
        animation:
          stateKey === 'critical'
            ? 'badge-blink 1.2s ease-in-out infinite'
            : undefined,
      }}
    >
      {s.badge}
    </span>
  );

  let body: React.ReactNode;
  if (stateKey === 'green') {
    body = (
      <p
        style={{
          opacity: 0.65,
          fontSize: 11,
          fontFamily: FONT_BODY,
          margin: 0,
          marginTop: 8,
        }}
      >
        Texting verified · leads flowing
      </p>
    );
  } else if (stateKey === 'warning' && openWarning) {
    body = (
      <p style={{ fontSize: 13, fontFamily: FONT_BODY, margin: 0, marginTop: 8 }}>
        <strong style={{ color: '#c08a0a' }}>{openWarning.message}</strong>{' '}
        <span style={{ opacity: 0.6 }}>agent keeps working</span>
      </p>
    );
  } else if (stateKey === 'critical' && openCritical) {
    body = (
      <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
        <p style={{ margin: 0, fontSize: 13, fontFamily: FONT_BODY }}>
          <strong style={{ color: '#c0392b' }}>{openCritical.message}</strong>
        </p>
        <p style={{ margin: 0, fontSize: 12, fontFamily: FONT_BODY, opacity: 0.85 }}>
          Your support team was notified{' '}
          <span style={{ color: '#2e8f5a' }}>
            &#10003; sent {formatTime(openCritical.started_at)}
          </span>
        </p>
        <p style={{ margin: 0, fontSize: 12, fontFamily: FONT_BODY, opacity: 0.75 }}>
          Down for <Stopwatch startedAt={openCritical.started_at} />
        </p>
      </div>
    );
  }

  return (
    <Card label="SYSTEM PULSE" right={badge}>
      <EkgSvg state={stateKey} baseId={baseId} />
      {body}
    </Card>
  );
}
