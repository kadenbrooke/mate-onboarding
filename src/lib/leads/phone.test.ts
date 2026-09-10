import { describe, it, expect } from 'vitest';
import { toE164, phoneRejectionMessage } from './phone';

describe('toE164', () => {
  it('adds +1 to a bare 10 digit US number', () => {
    expect(toE164('8015551234')).toEqual({ ok: true, e164: '+18015551234', leadKey: '8015551234' });
  });

  it('reads the way a human writes a number on a note', () => {
    for (const written of ['(801) 555-1234', '801-555-1234', '801.555.1234', '801 555 1234']) {
      expect(toE164(written)).toEqual({ ok: true, e164: '+18015551234', leadKey: '8015551234' });
    }
  });

  it('treats a leading 1 as the same number', () => {
    expect(toE164('1-801-555-1234')).toEqual({ ok: true, e164: '+18015551234', leadKey: '8015551234' });
  });

  it('keeps an already-E164 number as written', () => {
    expect(toE164('+18015551234')).toEqual({ ok: true, e164: '+18015551234', leadKey: '8015551234' });
  });

  it('accepts a non-US number that arrives with its +', () => {
    const r = toE164('+442071838750');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe('+442071838750');
  });

  it('rejects a short number instead of padding it', () => {
    expect(toE164('5551234')).toEqual({ ok: false, reason: 'too-short' });
  });

  it('rejects empty and whitespace', () => {
    expect(toE164('')).toEqual({ ok: false, reason: 'empty' });
    expect(toE164('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(toE164(null)).toEqual({ ok: false, reason: 'empty' });
    expect(toE164(undefined)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a number with no digits at all', () => {
    expect(toE164('call the shop')).toEqual({ ok: false, reason: 'empty' });
  });

  // The misread case that matters. An extra digit read off a handwritten note
  // must never be silently truncated into a real, different person's number.
  it('refuses an 11 digit number that does not start with 1', () => {
    expect(toE164('98015551234')).toEqual({ ok: false, reason: 'not-dialable' });
  });

  it('rejects an absurdly long string of digits', () => {
    expect(toE164('1234567890123456')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('never invents an area code', () => {
    // Seven digits is a local number with the area code missing. Guessing it
    // would text whoever holds that number in whatever area code we picked.
    const r = toE164('555-1234');
    expect(r.ok).toBe(false);
  });

  it('gives the same leadKey for every way one number is written', () => {
    const keys = ['8015551234', '(801) 555-1234', '+18015551234', '1 801 555 1234']
      .map(toE164)
      .map(r => (r.ok ? r.leadKey : null));
    expect(new Set(keys)).toEqual(new Set(['8015551234']));
  });
});

describe('phoneRejectionMessage', () => {
  it('has plain language for every rejection reason', () => {
    for (const reason of ['empty', 'too-short', 'too-long', 'not-dialable'] as const) {
      const msg = phoneRejectionMessage(reason);
      expect(msg.length).toBeGreaterThan(0);
      // Brand rule: no em dashes anywhere, including copy the client reads.
      expect(msg).not.toContain('—');
    }
  });
});
