import { describe, it, expect } from 'vitest';
import {
  applyTokenResponse,
  isAccessTokenExpired,
  isRefreshTokenExpired,
  tokenAction,
  ACCESS_TOKEN_SKEW_SECONDS,
  type QboTokenResponse,
} from './tokens';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function tokenResponse(over: Partial<QboTokenResponse> = {}): QboTokenResponse {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-NEW',
    expires_in: 3600,
    x_refresh_token_expires_in: 8_640_000, // 100 days
    token_type: 'bearer',
    ...over,
  };
}

describe('applyTokenResponse (refresh-token rotation)', () => {
  it('persists the NEW rotated refresh token from the response, not the old one', () => {
    // The #1 QBO failure mode: keeping the old refresh token. The rotated token
    // in the RESPONSE is what must be stored.
    const applied = applyTokenResponse(tokenResponse({ refresh_token: 'refresh-ROTATED-2' }), NOW);
    expect(applied.refresh_token).toBe('refresh-ROTATED-2');
  });

  it('computes access + refresh expiry as absolute ISO timestamps from now', () => {
    const applied = applyTokenResponse(tokenResponse(), NOW);
    expect(applied.access_token).toBe('access-1');
    // 3600s after NOW.
    expect(applied.access_token_expires_at).toBe('2026-08-06T13:00:00.000Z');
    // 100 days after NOW.
    expect(applied.refresh_token_expires_at).toBe('2026-11-14T12:00:00.000Z');
  });

  it('tolerates a missing refresh-token-expiry (null, not a crash)', () => {
    const applied = applyTokenResponse(tokenResponse({ x_refresh_token_expires_in: undefined }), NOW);
    expect(applied.refresh_token_expires_at).toBeNull();
    expect(applied.refresh_token).toBe('refresh-NEW');
  });

  it('a full refresh cycle carries the rotated token forward each time', () => {
    // Simulate two consecutive refreshes: each returns a fresh refresh token,
    // and each application must adopt it (never reuse the prior one).
    const first = applyTokenResponse(tokenResponse({ refresh_token: 'r2', access_token: 'a2' }), NOW);
    expect(first.refresh_token).toBe('r2');
    const later = new Date(NOW.getTime() + 3600 * 1000);
    const second = applyTokenResponse(tokenResponse({ refresh_token: 'r3', access_token: 'a3' }), later);
    expect(second.refresh_token).toBe('r3');
    expect(second.access_token).toBe('a3');
    expect(second.access_token_expires_at).toBe('2026-08-06T14:00:00.000Z');
  });
});

describe('isAccessTokenExpired', () => {
  it('is false while the token is comfortably valid', () => {
    const future = new Date(NOW.getTime() + 3600 * 1000).toISOString();
    expect(isAccessTokenExpired(future, NOW)).toBe(false);
  });

  it('is true once past expiry', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isAccessTokenExpired(past, NOW)).toBe(true);
  });

  it('is true inside the skew window (refresh a little early)', () => {
    // Expires in 30s, skew is 60s -> treat as already expired.
    const soon = new Date(NOW.getTime() + 30 * 1000).toISOString();
    expect(isAccessTokenExpired(soon, NOW, ACCESS_TOKEN_SKEW_SECONDS)).toBe(true);
  });

  it('treats null / missing / unparseable expiry as expired', () => {
    expect(isAccessTokenExpired(null, NOW)).toBe(true);
    expect(isAccessTokenExpired(undefined, NOW)).toBe(true);
    expect(isAccessTokenExpired('not-a-date', NOW)).toBe(true);
  });
});

describe('isRefreshTokenExpired', () => {
  it('is true only after the 100-day expiry passes', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const future = new Date(NOW.getTime() + 1000).toISOString();
    expect(isRefreshTokenExpired(past, NOW)).toBe(true);
    expect(isRefreshTokenExpired(future, NOW)).toBe(false);
  });

  it('treats unknown expiry as still valid (let the API decide)', () => {
    expect(isRefreshTokenExpired(null, NOW)).toBe(false);
  });
});

describe('tokenAction', () => {
  const valid = new Date(NOW.getTime() + 3600 * 1000).toISOString();
  const expired = new Date(NOW.getTime() - 1000).toISOString();
  const refreshAlive = new Date(NOW.getTime() + 86_400_000).toISOString();

  it('ok when access token is still valid', () => {
    expect(tokenAction({ access_token_expires_at: valid, refresh_token: 'r', refresh_token_expires_at: refreshAlive }, NOW)).toBe('ok');
  });

  it('refresh when access expired but refresh token is alive', () => {
    expect(tokenAction({ access_token_expires_at: expired, refresh_token: 'r', refresh_token_expires_at: refreshAlive }, NOW)).toBe('refresh');
  });

  it('reconnect when there is no refresh token', () => {
    expect(tokenAction({ access_token_expires_at: expired, refresh_token: null, refresh_token_expires_at: null }, NOW)).toBe('reconnect');
  });

  it('reconnect when the refresh token itself has expired', () => {
    expect(tokenAction({ access_token_expires_at: expired, refresh_token: 'r', refresh_token_expires_at: expired }, NOW)).toBe('reconnect');
  });
});
