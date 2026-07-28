export const BRAND_RAMP = [
  'var(--brand-primary, #e14d1a)',
  '#e1774d',
  '#b86a4a',
  '#8a5a42',
  '#6a4a38',
];

// Categorical lead-source palette -- one distinct hue per source so segments
// are tellable apart on the light theme (shared by SourceDonut + JourneyRiver).
export const SOURCE_COLORS: Record<string, string> = {
  missed_call: 'var(--brand-primary, #e14d1a)',
  texted_in: '#3b76c4',
  web_form: '#7d5bbe',
  referral: '#2e8f5a',
  revived: '#1f9490',
  unknown: '#a89e91',
};

export const SOURCE_LABELS: Record<string, string> = {
  missed_call: 'Missed call',
  texted_in: 'Texted in',
  web_form: 'Web form',
  referral: 'Referral',
  revived: 'Revived',
  unknown: 'Other',
};
