import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyCalcomSignature } from './verify';

const secret = 'whsec_test';
const body = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'abc' } });
const sign = (b: string, s: string) => createHmac('sha256', s).update(b, 'utf8').digest('hex');

describe('verifyCalcomSignature', () => {
  it('accepts a correct HMAC-SHA256 hex signature', () => {
    expect(verifyCalcomSignature(body, sign(body, secret), secret)).toBe(true);
  });
  it('is case-insensitive on the incoming hex', () => {
    expect(verifyCalcomSignature(body, sign(body, secret).toUpperCase(), secret)).toBe(true);
  });
  it('rejects a wrong signature', () => {
    expect(verifyCalcomSignature(body, sign(body, 'other_secret'), secret)).toBe(false);
  });
  it('rejects a tampered body', () => {
    expect(verifyCalcomSignature(body + ' ', sign(body, secret), secret)).toBe(false);
  });
  it('rejects when signature or secret is missing', () => {
    expect(verifyCalcomSignature(body, null, secret)).toBe(false);
    expect(verifyCalcomSignature(body, sign(body, secret), undefined)).toBe(false);
  });
});
