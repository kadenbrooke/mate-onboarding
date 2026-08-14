import { describe, it, expect } from 'vitest';
import { formatPhone, leadIdentity, leadLabel } from './leadName';

describe('formatPhone', () => {
  it('formats a 10-digit number', () => {
    expect(formatPhone('8019007550')).toBe('(801) 900-7550');
  });

  it('strips the US country code from an E.164 number', () => {
    expect(formatPhone('+18019007550')).toBe('(801) 900-7550');
  });

  it('normalizes an already-punctuated number to the house format', () => {
    expect(formatPhone('(801) 900 7550')).toBe('(801) 900-7550');
  });

  it('returns non-US / unparseable numbers trimmed and unchanged', () => {
    expect(formatPhone('  +44 20 7946 0958 ')).toBe('+44 20 7946 0958');
    expect(formatPhone('555-1234')).toBe('555-1234');
  });

  it('treats null, undefined and whitespace as absent', () => {
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone(undefined)).toBeNull();
    expect(formatPhone('   ')).toBeNull();
  });
});

describe('leadIdentity', () => {
  it('prefers a real name and marks it named', () => {
    expect(leadIdentity({ name: 'Steven Letsinger', phone: '+18017931734', source: 'meta' }))
      .toEqual({ label: 'Steven Letsinger', named: true });
  });

  it('treats a whitespace-only name as absent', () => {
    expect(leadIdentity({ name: '   ', phone: '+18019007550', source: 'call' }))
      .toEqual({ label: '(801) 900-7550', named: false });
  });

  it('falls back to the formatted phone for a nameless call lead', () => {
    expect(leadIdentity({ name: null, phone: '+18019007550', source: 'call' }))
      .toEqual({ label: '(801) 900-7550', named: false });
  });

  it('falls back to a source noun when there is no name and no phone', () => {
    expect(leadIdentity({ name: null, phone: null, source: 'call' }))
      .toEqual({ label: 'Caller', named: false });
    expect(leadIdentity({ name: null, phone: null, source: 'meta' }))
      .toEqual({ label: 'Meta lead', named: false });
  });

  it('falls back to a generic label for an unknown source', () => {
    expect(leadIdentity({ name: null, phone: null, source: 'unknown' }))
      .toEqual({ label: 'Unnamed lead', named: false });
  });

  it('never returns an empty label, even with nothing to go on', () => {
    expect(leadIdentity({}).label).toBe('Unnamed lead');
    expect(leadIdentity({ name: null, phone: null, source: null }).label).toBe('Unnamed lead');
  });
});

describe('leadLabel', () => {
  it('returns the identity label alone', () => {
    expect(leadLabel({ name: null, phone: '+18019007550', source: 'call' })).toBe('(801) 900-7550');
  });
});
