// CrewRoster - YOUR CREW card.
//
// The roster is the four product agents by their real names, always all four,
// in fixed order. A client who has only bought two still sees the other two
// (LOCKED) -- that is the point of the card. Status comes from the client's
// client_capabilities rows, matched by capability_key (with the legacy
// first_responder_sms alias); an agent with no row is LOCKED, never assumed
// live. DB status values are 'live', 'demo', 'under_construction', 'complete';
// only 'live' (and 'active' for forward-compat) renders the LIVE pill, matching
// how capability.ts defines "usable".
//
// Each row's chip carries a Phosphor icon for the agent's job rather than
// initials: lightning (instant response), plant (nurture), arrows-clockwise
// (win-back), star (reviews). Icon language matches the Auto Mate 5 demo.

import type { ReactNode } from 'react';
import { Lightning, Plant, ArrowsClockwise, Star } from '@phosphor-icons/react';
import { Card } from '../Card';
import { FONT_BODY, FREE_GREEN, brandVar, CARD_TRACK, CARD_MUTED, CARD_FG, CARD_HAIRLINE } from '@/lib/theme';
import type { DashCapability } from '../types';

// Canonical crew, display order fixed. `aliases` are the capability_key values
// a backend row may legitimately use for this agent.
const CREW: { key: string; label: string; aliases: string[]; icon: ReactNode; hint: string }[] = [
  {
    key: 'first_responder', label: 'First Responder',
    aliases: ['first_responder', 'first_responder_sms'],
    icon: <Lightning size={17} weight="fill" />,
    hint: 'answers every lead in seconds',
  },
  {
    key: 'cultivator', label: 'Cultivator',
    aliases: ['cultivator'],
    icon: <Plant size={17} weight="fill" />,
    hint: 'follows up until they book',
  },
  {
    key: 'reactivator', label: 'Reactivator',
    aliases: ['reactivator'],
    icon: <ArrowsClockwise size={17} weight="bold" />,
    hint: 'coming soon',
  },
  {
    key: 'reputation_manager', label: 'Reputation Manager',
    aliases: ['reputation_manager', 'reputation_builder', 'reputation', 'gbp_reviews'],
    icon: <Star size={17} weight="fill" />,
    hint: 'coming soon',
  },
];

function isLive(status: string): boolean {
  return status === 'live' || status === 'active';
}

/** True when one of this agent's capability rows says it is live. */
function agentIsLive(aliases: string[], capabilities: DashCapability[]): boolean {
  return capabilities.some(c => aliases.includes(c.key) && isLive(c.status));
}

function CrewChip({ icon, live }: { icon: ReactNode; live: boolean }) {
  const bg = live
    ? `radial-gradient(circle at 40% 35%, ${brandVar}, #a0340f)`
    : CARD_TRACK;
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
        color: live ? '#fff' : CARD_MUTED,
      }}
    >
      {icon}
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
          background: `color-mix(in srgb, ${FREE_GREEN} 10%, transparent)`,
          border: `1px solid color-mix(in srgb, ${FREE_GREEN} 30%, transparent)`,
          borderRadius: 99,
          padding: '2px 8px',
        }}
      >
        ● LIVE
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
        color: CARD_MUTED,
        background: CARD_TRACK,
        border: `1px solid ${CARD_HAIRLINE}`,
        borderRadius: 99,
        padding: '2px 8px',
      }}
    >
      LOCKED
    </span>
  );
}

function CrewRow({ agent, live }: {
  agent: (typeof CREW)[number];
  live: boolean;
}) {
  return (
    <div
      data-testid={`crew-row-${agent.key}`}
      data-live={live ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: live ? 1 : 0.65,
        marginTop: 10,
      }}
    >
      <CrewChip icon={agent.icon} live={live} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontFamily: FONT_BODY,
            color: CARD_FG,
            lineHeight: '1.2',
          }}
        >
          {agent.label}
        </div>
        <div
          style={{
            fontSize: 10,
            opacity: 0.55,
            fontFamily: FONT_BODY,
            marginTop: 2,
          }}
        >
          {agent.hint}
        </div>
      </div>
      <StatusPill live={live} />
    </div>
  );
}

export function CrewRoster({ capabilities }: { capabilities: DashCapability[] }) {
  return (
    <Card label="YOUR CREW">
      {CREW.map(agent => (
        <CrewRow key={agent.key} agent={agent} live={agentIsLive(agent.aliases, capabilities)} />
      ))}
    </Card>
  );
}
