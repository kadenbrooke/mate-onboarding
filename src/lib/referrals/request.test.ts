import { describe, expect, it } from 'vitest';
import { MAX_REFERRAL_BODY_BYTES, readReferralJsonBody } from './request';

describe('readReferralJsonBody', () => {
  it('rejects a body over the cap before parsing', async () => {
    const body = JSON.stringify({ name: 'x', padding: 'x'.repeat(MAX_REFERRAL_BODY_BYTES) });
    const result = await readReferralJsonBody(new Request('https://example.test', { method: 'POST', body }));
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('parses a small JSON body', async () => {
    const result = await readReferralJsonBody(new Request('https://example.test', {
      method: 'POST', body: JSON.stringify({ name: 'Test Lead' }),
    }));
    expect(result).toEqual({ ok: true, value: { name: 'Test Lead' } });
  });
});
