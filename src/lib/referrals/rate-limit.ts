export const MAX_REFERRAL_ATTEMPTS_PER_CODE_PER_DAY = 100;
export const MAX_REFERRAL_ATTEMPTS_PER_IP_PER_DAY = 20;

export type ReferralRateCounts = {
  codeCountToday: number;
  ipCountToday: number;
};

export type ReferralRateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: 'code' | 'ip' };

export function checkReferralRateLimit(
  counts: ReferralRateCounts,
  caps: { perCode?: number; perIp?: number } = {},
): ReferralRateLimitResult {
  const perCode = caps.perCode ?? MAX_REFERRAL_ATTEMPTS_PER_CODE_PER_DAY;
  const perIp = caps.perIp ?? MAX_REFERRAL_ATTEMPTS_PER_IP_PER_DAY;
  if (counts.codeCountToday >= perCode) return { allowed: false, reason: 'code' };
  if (counts.ipCountToday >= perIp) return { allowed: false, reason: 'ip' };
  return { allowed: true };
}
