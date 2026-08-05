'use client';
import { Robot, User } from '@phosphor-icons/react';
import { AGENT_GREEN, HUMAN_AMBER, SCORE_RED, FONT_BODY } from '@/lib/theme';
import type { HandlerState } from './driverToggle';

// A single clickable pill that shows AND toggles who's driving a lead's
// conversation. The pill IS the affordance -- no separate "Take over" button, no
// hint text inside it (founder note). Green = Mate's agent auto-handling; amber =
// you've taken over. Clicking flips it (optimistically, handled by the parent).

export function DriverPill({ handler, name, busy, error, onToggle, testId }: {
  handler: HandlerState;
  name: string | null;
  busy?: boolean;
  error?: string | null;
  onToggle: () => void;
  testId: string;
}) {
  const isAgent = handler === 'agent';
  const color = isAgent ? AGENT_GREEN : HUMAN_AMBER;
  const Icon = isAgent ? Robot : User;
  const label = isAgent ? 'Agent' : 'You';
  const who = name?.trim() || 'this lead';
  // aria-label describes the ACTION the click performs, not just the state.
  const action = isAgent
    ? `Mate's agent is handling ${who}. Activate to take over.`
    : `You are handling ${who}. Activate to hand back to Mate.`;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <button
        type="button"
        className="driver-pill"
        data-testid={testId}
        data-handler={handler}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        disabled={busy}
        aria-label={action}
        aria-invalid={error ? true : undefined}
        title={error ?? action}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          borderRadius: 99, padding: '4px 11px', minHeight: 30,
          cursor: busy ? 'default' : 'pointer',
          fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
          color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid ${error ? SCORE_RED : `color-mix(in srgb, ${color} 34%, transparent)`}`,
          opacity: busy ? 0.6 : 1,
          transition: 'background 120ms, opacity 120ms',
          whiteSpace: 'nowrap',
        }}
      >
        <Icon size={13} weight="fill" aria-hidden />
        <span>{label}</span>
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 9, color: SCORE_RED, fontFamily: FONT_BODY, maxWidth: 120, lineHeight: 1.2 }}>
          {error}
        </span>
      )}
    </span>
  );
}
