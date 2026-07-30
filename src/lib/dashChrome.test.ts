import { describe, it, expect } from 'vitest';
import { activeNavKey, businessInitials, RAIL_SECTIONS } from './dashChrome';

describe('activeNavKey', () => {
  it('marks the dashboard active on the dash root', () => {
    expect(activeNavKey('/dash/abc-123')).toBe('dashboard');
    expect(activeNavKey('/dash/abc-123/')).toBe('dashboard');
  });

  it('marks leads active on the leads page', () => {
    expect(activeNavKey('/dash/abc-123/leads')).toBe('leads');
    expect(activeNavKey('/dash/abc-123/leads/')).toBe('leads');
  });
});

describe('activeNavKey assistant', () => {
  it('detects assistant', () => { expect(activeNavKey('/dash/abc/assistant')).toBe('assistant'); });
  it('detects leads', () => { expect(activeNavKey('/dash/abc/leads')).toBe('leads'); });
  it('defaults to dashboard', () => { expect(activeNavKey('/dash/abc')).toBe('dashboard'); });
});

describe('businessInitials', () => {
  it('uses the capitals the business spells itself with', () => {
    expect(businessInitials('J&C Asphalt Paving')).toBe('JC');
    expect(businessInitials('Auto Mate')).toBe('AM');
  });

  it('falls back to first letters of the first two words', () => {
    expect(businessInitials('the paving guys')).toBe('TP');
  });

  it('handles single words and empties', () => {
    expect(businessInitials('asphalt')).toBe('AS');
    expect(businessInitials('')).toBe('--');
    expect(businessInitials(null)).toBe('--');
    expect(businessInitials(undefined)).toBe('--');
  });
});

describe('RAIL_SECTIONS', () => {
  it('covers the scroll zones in page order', () => {
    expect(RAIL_SECTIONS.map(s => s.id)).toEqual([
      'zone-leadflow', 'zone-speed', 'zone-ads', 'zone-followup', 'zone-reputation', 'zone-calendar',
    ]);
  });
});
