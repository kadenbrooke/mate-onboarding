export const BRAND_RAMP = [
  'var(--brand-primary, #e14d1a)',
  '#e1774d',
  '#b86a4a',
  '#8a5a42',
  '#6a4a38',
];

// Categorical palette for the Service wheel: BRAND_RAMP is five shades of
// the same orange, which reads as "all orange" once it's the only color on
// the Leads screen (SOURCE_COLORS already carries the visual variety there).
// Same hue family as SOURCE_COLORS so the screen still reads as one system,
// just distinct enough per-slice to tell services apart at a glance.
export const SERVICE_RAMP = [
  'var(--brand-primary, #e14d1a)',
  '#3b76c4',
  '#2e8f5a',
  '#7d5bbe',
  '#1f9490',
];

// Categorical lead-source palette -- one distinct hue per source so segments
// are tellable apart on the light theme (shared by SourceDonut + JourneyRiver).
// meta/call/text/referral/google are the closed taxonomy going forward (2026-08-05);
// missed_call/texted_in/web_form/revived/unknown are kept for legacy + still-live
// demo-session rows (see leads.ts Lead.source comment).
export const SOURCE_COLORS: Record<string, string> = {
  meta: '#e1774d',
  call: 'var(--brand-primary, #e14d1a)',
  text: '#3b76c4',
  referral: '#2e8f5a',
  google: '#8a5a42',
  missed_call: 'var(--brand-primary, #e14d1a)',
  texted_in: '#3b76c4',
  web_form: '#7d5bbe',
  revived: '#1f9490',
  unknown: '#a89e91',
};

export const SOURCE_LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  call: 'Call',
  text: 'Text',
  referral: 'Referral',
  google: 'Google',
  missed_call: 'Missed call',
  texted_in: 'Texted in',
  web_form: 'Web form',
  revived: 'Revived',
  unknown: 'Other',
};

// Categorical palette for Agent Activity -- same hue family as
// SERVICE_RAMP/SOURCE_COLORS so the app still reads as one system.
export const AGENT_COLORS: Record<string, string> = {
  first_responder: 'var(--brand-primary, #e14d1a)',
  reactivator: '#3b76c4',
  cultivator: '#2e8f5a',
  reputation: '#7d5bbe',
};

// Plain-language names, not internal agent codenames -- matches the "five
// pieces" copy on the Automate Utah marketing site (automateutah.com),
// which is the vocabulary an owner actually sees before they ever log in.
// Kept SHORT (1-2 words) on purpose: these sit in a fixed-width bar-chart
// label column (Agent Activity) that clips/truncates full phrases like
// "Instant Lead Response." cultivator -> quote follow-up; reactivator ->
// winback of past customers; reputation -> review + referral asks.
export const AGENT_LABELS: Record<string, string> = {
  first_responder: 'Lead Response',
  cultivator: 'Follow-Up',
  reactivator: 'Win-Back',
  reputation: 'Reviews',
};
