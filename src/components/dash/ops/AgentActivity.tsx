import { Card } from '../Card';
import { agentActivity } from '@/lib/metrics/agents';
import { AGENT_COLORS, AGENT_LABELS } from '@/lib/metrics/colors';
import type { ClientEvent } from '@/lib/metrics/events';
import { brandVar, CARD_TRACK, CARD_MUTED, NUM_TABLE, FONT_BODY } from '@/lib/theme';

// "Is this agent on" is CrewRoster's job. This answers "is it doing
// anything" -- actions handled per agent, trailing 30 days, ranked so the
// busiest (or quietest) agent reads at a glance. Same horizontal-bar
// pattern as City/Service so the tab reads as one system.

export function AgentActivity({ events }: { events: ClientEvent[] }) {
  const rows = agentActivity(events);
  const max = rows.length ? rows[0].count : 1;

  return (
    <Card label="AGENT ACTIVITY">
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: CARD_MUTED, marginTop: 10, fontFamily: FONT_BODY }}>
          no agent actions yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {rows.map(r => (
            <div key={r.agent} data-testid={`agent-bar-${r.agent}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11, fontFamily: FONT_BODY, width: 92, flexShrink: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {AGENT_LABELS[r.agent] ?? r.agent}
              </span>
              <div style={{ flex: 1, height: 10, background: CARD_TRACK, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(4, (r.count / max) * 100)}%`,
                  height: '100%',
                  background: AGENT_COLORS[r.agent] ?? brandVar,
                  borderRadius: 99,
                }} />
              </div>
              <span style={{ ...NUM_TABLE, fontSize: 11, width: 22, textAlign: 'right', flexShrink: 0 }}>
                {r.count}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: CARD_MUTED, opacity: 0.8, marginTop: 2, fontFamily: FONT_BODY }}>
            actions, last 30 days
          </div>
        </div>
      )}
    </Card>
  );
}
