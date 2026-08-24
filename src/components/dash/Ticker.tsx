'use client';
import { useEffect, useRef, useState } from 'react';
import type { ClientEvent } from '@/lib/metrics/events';
import { FONT_BODY, BG_CARD, CARD_SHADOW } from '@/lib/theme';
import {
  rollupEvents, mergeEvents, newestTimestamp, enteringKeys, type TickerGroup,
} from './tickerFeed';

// A STATIC strip, not a marquee. It used to scroll continuously, which meant
// the client could never read a line without chasing it. Now: newest activity
// pinned at the left, older leads trailing right, overflow clipped at the edge.
// When a new event arrives it takes slot one and shoves everything else right.
//
// Rolled up by lead (see tickerFeed.ts): a lead who gets texted five times owns
// ONE chip carrying a count, and re-texting a lead already on the strip moves
// their chip to the front instead of adding a duplicate.

const AGENT_COLOR: Record<ClientEvent['agent'], string> = {
  first_responder: 'var(--brand-primary, #e14d1a)',
  reactivator: '#7d5bbe',
  cultivator: '#2e8f5a',
  reputation: '#c08a0a',
};

/** How often the strip asks for events newer than what it holds. The dash is a
 *  glance surface people leave open, so this is deliberately unhurried: one
 *  indexed range scan per client per interval, and only while the tab is
 *  actually being looked at. */
const POLL_MS = 20_000;

function Chip({ group, entering }: { group: TickerGroup; entering: boolean }) {
  const { latest, count } = group;
  return (
    <span
      className={entering ? 'ticker-chip ticker-chip-enter' : 'ticker-chip'}
      data-testid={`ticker-chip-${group.key}`}
      style={{ fontSize: 11, opacity: 0.85, flexShrink: 0 }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: AGENT_COLOR[latest.agent], marginRight: 6, verticalAlign: 'middle',
        }}
      />
      {latest.message}
      {/* The rolled-up rows are still real events; the count says so rather
          than silently hiding four of the five. */}
      {count > 1 && (
        <span style={{ opacity: 0.6, marginLeft: 5 }} data-testid={`ticker-count-${group.key}`}>
          &times;{count}
        </span>
      )}
    </span>
  );
}

export function Ticker({ events, sessionId }: {
  events: ClientEvent[];
  /** Route id the poll asks against. Omitted in tests and anywhere a live feed
   *  is not wanted, in which case the strip renders the server snapshot and
   *  stays put. */
  sessionId?: string;
}) {
  // Server snapshot seeds the strip; the poll only ever prepends to it.
  const [held, setHeld] = useState<ClientEvent[]>(events);
  // A new server render (navigation, refresh) should win over stale polled
  // state rather than being merged behind it.
  useEffect(() => { setHeld(events); }, [events]);

  const groups = rollupEvents(held);
  // Which chips are new SINCE THE LAST RENDER, so only those animate in. Held
  // in a ref because comparing against previous render output is exactly what a
  // ref is for, and putting it in state would loop.
  const prevGroups = useRef<TickerGroup[]>([]);
  const entering = enteringKeys(prevGroups.current, groups);
  // First paint is not an arrival: the whole strip would flare at once.
  const isFirstPaint = prevGroups.current.length === 0;
  useEffect(() => { prevGroups.current = groups; });

  // The poll reads the watermark through a ref, not the closure, so the
  // interval is set up once per session instead of being torn down and
  // rescheduled every time a merge lands.
  const heldRef = useRef(held);
  useEffect(() => { heldRef.current = held; }, [held]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function poll() {
      // Nothing on screen means no watermark to ask from; a `since`-less fetch
      // would pull the whole feed at once.
      const since = newestTimestamp(heldRef.current);
      if (!since) return;
      // Background tabs do not need a live ticker, and polling them is how a
      // left-open dashboard turns into steady pointless load.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(
          `/api/dash/${sessionId}/events?since=${encodeURIComponent(since)}`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const body = await res.json() as { events?: ClientEvent[] };
        if (cancelled || !body.events?.length) return;
        // mergeEvents returns the same reference when nothing is genuinely new,
        // so this cannot spin the strip on an unchanged feed.
        setHeld(prev => mergeEvents(prev, body.events!));
      } catch {
        // A failed poll is not worth surfacing: the strip keeps showing the
        // last good feed and the next tick tries again.
      }
    }

    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sessionId]);

  if (groups.length === 0) return null;

  return (
    <div style={{
      overflow: 'hidden', background: BG_CARD, borderRadius: 99,
      boxShadow: CARD_SHADOW, padding: '7px 0', position: 'relative',
    }}>
      <style>{`
        /* The push: an arriving chip expands from zero width, which is what
           physically displaces its neighbours to the right. max-width is used
           because width:auto is not animatable; the cap is far wider than any
           one-line event message, so a chip never rests clipped. */
        @keyframes ticker-push-in {
          from { max-width: 0; opacity: 0; transform: translateX(-6px); }
          to   { max-width: 640px; opacity: .85; transform: none; }
        }
        .ticker-chip { max-width: none; }
        .ticker-chip-enter { animation: ticker-push-in 420ms cubic-bezier(.2,.7,.3,1); }
        @media (prefers-reduced-motion: reduce) {
          .ticker-chip-enter { animation: none !important; }
        }
      `}</style>
      <div
        data-testid="ticker-track"
        style={{
          display: 'flex', gap: 28, whiteSpace: 'nowrap', paddingLeft: 12,
          fontFamily: FONT_BODY,
        }}
      >
        {groups.map(g => (
          <Chip key={g.key} group={g} entering={!isFirstPaint && entering.has(g.key)} />
        ))}
      </div>
    </div>
  );
}
