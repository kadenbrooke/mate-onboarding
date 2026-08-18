import { Card } from '../Card';
import {
  FREE_GREEN, brandVar, CARD_TRACK, CARD_MUTED, FONT_BODY, NUM_DISPLAY, NUM_TABLE,
} from '@/lib/theme';

const INDUSTRY_AVG_MINUTES = 47;
const FIRST_RESPONDER_STAT = 78;

// Response-time comparison: your agent now vs industry avg. Light redesign:
// big response-time number up top, rounded lanes on beige tracks below
// (bar length proportional to response time, so shorter = better).

function Lane({ label, fillPct, fillColor, value, valueColor, note }: {
  label: string;
  fillPct: number | null; // null = no data yet, show empty track
  fillColor?: string;
  value?: string;
  valueColor?: string;
  note?: string;
}) {
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 1, color: CARD_MUTED, fontFamily: FONT_BODY }}>
          {label}
        </span>
        {value != null
          ? <span style={{ ...NUM_TABLE, fontSize: 12, color: valueColor ?? 'inherit' }}>{value}</span>
          : <span style={{ fontSize: 9, color: CARD_MUTED, fontFamily: FONT_BODY }}>{note}</span>}
      </div>
      <div style={{ background: CARD_TRACK, borderRadius: 99, height: 10, overflow: 'hidden' }}>
        {fillPct != null && (
          <div style={{
            width: `${Math.max(2, Math.min(100, fillPct))}%`,
            height: '100%',
            background: fillColor,
            borderRadius: 99,
          }} />
        )}
      </div>
    </div>
  );
}

/**
 * `avgReplySeconds` is null when no lead carries a measured reply time. That is
 * an empty state, not a 0-second response: rendering "0 sec avg response" out
 * of missing data claimed an instant reply the agent never made.
 *
 * `leadCount` separates the two ways the number can be missing, because the
 * honest copy differs: no leads have arrived yet, versus leads arrived and
 * nothing timed the replies.
 */
export function RaceCard({ avgReplySeconds, leadCount = 0 }: {
  avgReplySeconds: number | null; leadCount?: number;
}) {
  const warming = avgReplySeconds == null;
  const untracked = warming && leadCount > 0;
  const industrySeconds = INDUSTRY_AVG_MINUTES * 60;
  const agentFillPct = ((avgReplySeconds ?? 0) / industrySeconds) * 100;
  const multiple = Math.max(1, Math.round(industrySeconds / Math.max(avgReplySeconds ?? 1, 1)));

  return (
    <Card label="RESPONSE TIME">
      {/* Big response-time stat */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
        {warming ? (
          <span style={{ fontSize: 13, color: CARD_MUTED, fontFamily: FONT_BODY }}>
            {untracked ? 'response time not tracked yet' : 'waiting for your first lead'}
          </span>
        ) : (
          <>
            <span style={{ ...NUM_DISPLAY, fontSize: 32, lineHeight: 1 }}>{avgReplySeconds}</span>
            <span style={{ fontSize: 13, color: CARD_MUTED, fontFamily: FONT_BODY }}>sec avg response</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Lane
          label="YOUR AGENT NOW"
          fillPct={warming ? null : agentFillPct}
          fillColor={brandVar}
          value={warming ? undefined : `${avgReplySeconds} sec`}
          valueColor={brandVar}
          note={warming ? (untracked ? 'no reply times recorded' : 'no replies yet') : undefined}
        />
        <Lane
          label="INDUSTRY AVERAGE"
          fillPct={100}
          fillColor="#b8b0a4"
          value={`${INDUSTRY_AVG_MINUTES} min`}
          valueColor={CARD_MUTED}
        />
      </div>

      {/* Footer */}
      <div style={{ fontSize: 12, fontFamily: FONT_BODY, color: CARD_MUTED, marginTop: 12, lineHeight: 1.5 }}>
        {warming ? (
          <>{FIRST_RESPONDER_STAT}% of jobs go to the first responder.</>
        ) : (
          <>
            You beat the average company by{' '}
            <b style={{ color: FREE_GREEN }}>{multiple}x</b>
            {'. '}{FIRST_RESPONDER_STAT}% of jobs go to the first responder.
          </>
        )}
      </div>
    </Card>
  );
}
