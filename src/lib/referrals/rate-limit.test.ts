import { describe, expect, it } from 'vitest';
import { checkReferralRateLimit } from './rate-limit';

describe('checkReferralRateLimit', () => {
  it('allows a request below both caps', () => {
    expect(checkReferralRateLimit({ codeCountToday: 2, ipCountToday: 3 }, { perCode: 3, perIp: 4 }))
      .toEqual({ allowed: true });
  });

  it('denies the code cap before the IP cap', () => {
    expect(checkReferralRateLimit({ codeCountToday: 3, ipCountToday: 4 }, { perCode: 3, perIp: 4 }))
      .toEqual({ allowed: false, reason: 'code' });
  });

  it('denies an abusive IP even when the code is still available', () => {
    expect(checkReferralRateLimit({ codeCountToday: 2, ipCountToday: 4 }, { perCode: 3, perIp: 4 }))
      .toEqual({ allowed: false, reason: 'ip' });
  });
});
