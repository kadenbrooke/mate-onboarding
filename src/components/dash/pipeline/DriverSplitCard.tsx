'use client';
import { driverSplit } from '@/lib/metrics/driver';
import type { Lead } from '@/lib/metrics/leads';
import { Card } from '../Card';
import { RingStat } from '../RingStat';
import { AGENT_GREEN, HUMAN_AMBER, CARD_MUTED, FONT_BODY } from '@/lib/theme';

// Manual vs. Automated -- how much of the conversation load the agent is
// carrying. Replaces the HOURS SAVED and ACTIONS hero cards, which both
// estimated the same idea from an assumed minutes-per-action constant; this
// counts real rows instead (client_leads.handler, the operator-takeover flag).
//
// A 180-degree gauge rather than a full donut: two mutually exclusive parts of
// one workload read as a meter, and a full circle over-reads as "everything".
// Colors are the Driver pill's, so the card and the pipeline table's DRIVER
// column say the same thing in the same green and amber.

export function DriverSplitCard({ leads, showLabel = true }: { leads: Lead[]; showLabel?: boolean }) {
  const s = driverSplit(leads);

  return (
    <Card
      label={showLabel ? 'MANUAL VS. AUTOMATED' : undefined}
      themeKey="manual-vs-automated"
      style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
    >
      {/* flex:1 + centering: the card is stretched to the hero row's height,
          so the gauge sits mid-card instead of leaving a void below it. */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <RingStat
          variant="half"
          idPrefix="driver"
          size={160}
          caption="CONVERSATIONS"
          segments={[
            {
              key: 'agent',
              label: 'AUTOMATED',
              value: s.agent,
              display: String(s.agent),
              color: AGENT_GREEN,
              sub: `${s.agentPct}% handled by Mate`,
            },
            {
              key: 'human',
              label: 'MANUAL',
              value: s.human,
              display: String(s.human),
              color: HUMAN_AMBER,
              sub: `${s.humanPct}% you took over`,
            },
          ]}
          center={{
            label: 'AUTOMATED',
            display: `${s.agentPct}%`,
            color: AGENT_GREEN,
            sub: `${s.agent} of ${s.total} conversations`,
          }}
          ariaLabel={
            s.total === 0
              ? 'No conversations yet'
              : `${s.agent} of ${s.total} conversations automated (${s.agentPct}%), ${s.human} handled manually (${s.humanPct}%)`
          }
        />
      </div>
      {s.total === 0 && (
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: CARD_MUTED, fontFamily: FONT_BODY }}>
          Your split shows up here as conversations come in
        </div>
      )}
    </Card>
  );
}
