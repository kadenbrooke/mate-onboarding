// CrewRoster — YOUR CREW card.
// Each row shows a 34px chip + label + status pill.
// Chips are initials placeholders; 8-bit glowing character sprites are a future
// pass pending founder decision (Plan 3).
// Status mapping: DB values are 'live', 'demo', 'under_construction', 'complete'.
// Only 'live' (and 'active' for forward-compat) renders the LIVE pill; all else
// render LOCKED. This matches how capability.ts defines "usable".

import { Card } from '../Card';
import { FONT_BODY, FREE_GREEN, brandVar } from '@/lib/theme';
import type { DashCapability } from '../types';

const UNLOCK_HINTS: Record<string, string> = {
  gbp_reviews: 'unlocks when Google is connected',
};

function initials(label: string): string {
  const words = label.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

function isLive(status: string): boolean {
  return status === 'live' || status === 'active';
}

function CrewChip({ label, live }: { label: string; live: boolean }) {
  const bg = live
    ? `radial-gradient(circle at 40% 35%, ${brandVar}, #a0340f)`
    : '#2a2a2a';
  return (
    <div
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: FONT_BODY,
        color: live ? '#fff' : '#555',
        letterSpacing: 0.5,
      }}
    >
      {initials(label)}
    </div>
  );
}

function StatusPill({ live }: { live: boolean }) {
  if (live) {
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          fontFamily: FONT_BODY,
          letterSpacing: 1,
          color: FREE_GREEN,
          background: '#3aa76d18',
          border: '1px solid #3aa76d44',
          borderRadius: 4,
          padding: '2px 6px',
        }}
      >
        LIVE
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        fontFamily: FONT_BODY,
        letterSpacing: 1,
        color: '#555',
        background: '#2a2a2a',
        border: '1px solid #333',
        borderRadius: 4,
        padding: '2px 6px',
      }}
    >
      LOCKED
    </span>
  );
}

function CrewRow({ cap }: { cap: DashCapability }) {
  const live = isLive(cap.status);
  const hint = live ? null : (UNLOCK_HINTS[cap.key] ?? 'unlocks soon');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: live ? 1 : 0.65,
        marginTop: 10,
      }}
    >
      <CrewChip label={cap.label} live={live} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontFamily: FONT_BODY,
            color: '#ede6e6',
            lineHeight: '1.2',
          }}
        >
          {cap.label}
        </div>
        {hint && (
          <div
            style={{
              fontSize: 10,
              opacity: 0.55,
              fontFamily: FONT_BODY,
              marginTop: 2,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <StatusPill live={live} />
    </div>
  );
}

export function CrewRoster({ capabilities }: { capabilities: DashCapability[] }) {
  const body =
    capabilities.length === 0 ? (
      <div
        style={{
          opacity: 0.45,
          fontSize: 12,
          fontFamily: FONT_BODY,
          marginTop: 10,
        }}
      >
        Your crew assembles as each agent goes live
      </div>
    ) : (
      capabilities.map((cap) => <CrewRow key={cap.key} cap={cap} />)
    );

  return <Card label="YOUR CREW">{body}</Card>;
}
