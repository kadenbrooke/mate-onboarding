import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a cal.com webhook signature. cal.com signs the RAW request body with
 * HMAC-SHA256 keyed by the webhook secret and sends the lowercase hex digest in
 * the `x-cal-signature-256` header. Compare in constant time.
 *
 * Returns false on any missing input so an unconfigured/unsigned request is
 * rejected rather than trusted.
 */
export function verifyCalcomSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
