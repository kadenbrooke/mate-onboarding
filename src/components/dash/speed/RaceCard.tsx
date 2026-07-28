import { Card } from '../Card';
import { FREE_GREEN, brandVar, FONT_BODY, NUM_DISPLAY } from '@/lib/theme';

const INDUSTRY_AVG_MINUTES = 47;
const FIRST_RESPONDER_STAT = 78;

export function RaceCard({ avgReplySeconds }: { avgReplySeconds: number }) {
  const agentFillPct = Math.max(2, Math.min(100, (avgReplySeconds / (INDUSTRY_AVG_MINUTES * 60)) * 100));
  const multiple = Math.max(1, Math.round((INDUSTRY_AVG_MINUTES * 60) / Math.max(avgReplySeconds, 1)));
  const agentLabel = `${avgReplySeconds} sec`;

  return (
    <Card label="SPEED TO LEAD">
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Lane 1: Agent now */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, fontFamily: FONT_BODY, marginBottom: 4 }}>
            YOUR AGENT NOW
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: '#1d1d1d', borderRadius: 6, height: 12, overflow: 'hidden' }}>
              <div style={{
                width: `${agentFillPct}%`,
                height: '100%',
                background: `linear-gradient(90deg, #8a2f0f, ${brandVar})`,
                borderRadius: 6,
                boxShadow: `0 0 8px ${brandVar}`,
              }} />
            </div>
            <span style={{ ...NUM_DISPLAY, fontSize: 13, color: brandVar, minWidth: 42, textAlign: 'right' }}>
              {agentLabel}
            </span>
          </div>
        </div>

        {/* Lane 2: You before - always shown with placeholder until Setup provides a value */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, fontFamily: FONT_BODY, marginBottom: 4 }}>
            YOU, BEFORE THE AGENT
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1, background: '#1d1d1d', borderRadius: 6, height: 12,
              border: '1px dashed #333',
            }} />
            <span style={{ fontSize: 10, opacity: 0.45, fontFamily: FONT_BODY, minWidth: 42, textAlign: 'right' }}>
              add your old reply time in Setup
            </span>
          </div>
        </div>

        {/* Lane 3: Industry average */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, fontFamily: FONT_BODY, marginBottom: 4 }}>
            INDUSTRY AVERAGE
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: '#1d1d1d', borderRadius: 6, height: 12, overflow: 'hidden' }}>
              <div style={{
                width: '58%',
                height: '100%',
                background: '#555',
                borderRadius: 6,
              }} />
            </div>
            <span style={{ ...NUM_DISPLAY, fontSize: 13, color: '#666', minWidth: 42, textAlign: 'right' }}>
              {INDUSTRY_AVG_MINUTES} min
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ fontSize: 12, fontFamily: FONT_BODY, opacity: 0.7, marginTop: 2, lineHeight: 1.5 }}>
          You beat the average company by{' '}
          <b style={{ color: FREE_GREEN }}>{multiple}x</b>
          {' '}{FIRST_RESPONDER_STAT}% of jobs go to the first responder.
        </div>
      </div>
    </Card>
  );
}
