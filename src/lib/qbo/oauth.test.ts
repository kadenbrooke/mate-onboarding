import { describe, it, expect } from 'vitest';
import {
  buildAuthorizeUrl,
  buildTokenExchangeRequest,
  buildRefreshRequest,
  basicAuthHeader,
  extractIntuitTid,
} from './oauth';
import { signState, verifyState, newNonce } from './state';

describe('basicAuthHeader', () => {
  it('base64-encodes clientId:clientSecret', () => {
    expect(basicAuthHeader('abc', 'secret')).toBe(`Basic ${Buffer.from('abc:secret').toString('base64')}`);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes client_id, response_type=code, scope, redirect_uri, and state', () => {
    const url = new URL(buildAuthorizeUrl({
      authorizationEndpoint: 'https://appcenter.intuit.com/connect/oauth2',
      clientId: 'client-1',
      redirectUri: 'https://mate.auto-mate.business/api/qb/callback',
      state: 'signed-state',
    }));
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mate.auto-mate.business/api/qb/callback');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });
});

describe('token requests', () => {
  it('exchange request is a form POST with Basic auth and the code (secret not in body)', () => {
    const req = buildTokenExchangeRequest({
      tokenEndpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      clientId: 'c', clientSecret: 's', code: 'auth-code', redirectUri: 'https://x/cb',
    });
    expect(req.method).toBe('POST');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.headers.Authorization).toBe(basicAuthHeader('c', 's'));
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(req.body).not.toContain('client_secret');
  });

  it('refresh request carries grant_type=refresh_token and the refresh token', () => {
    const req = buildRefreshRequest({
      tokenEndpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      clientId: 'c', clientSecret: 's', refreshToken: 'refresh-1',
    });
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');
  });
});

describe('extractIntuitTid', () => {
  it('reads the intuit_tid trace header from a Headers object', () => {
    const h = new Headers({ intuit_tid: 'tid-123' });
    expect(extractIntuitTid(h)).toBe('tid-123');
  });
  it('reads it from a plain object and returns null when absent', () => {
    expect(extractIntuitTid({ intuit_tid: 'tid-9' })).toBe('tid-9');
    expect(extractIntuitTid({})).toBeNull();
  });
});

describe('OAuth state CSRF token', () => {
  const secret = 'test-secret';

  it('round-trips a signed state back to its sessionId + nonce', () => {
    const nonce = newNonce();
    const token = signState({ sessionId: 'sess-A', nonce }, secret);
    expect(verifyState(token, secret)).toEqual({ sessionId: 'sess-A', nonce });
  });

  it('rejects a state signed with a different secret (forgery)', () => {
    const token = signState({ sessionId: 'sess-A', nonce: 'n1' }, secret);
    expect(verifyState(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered sessionId (attacker swaps the target session)', () => {
    const token = signState({ sessionId: 'sess-A', nonce: 'n1' }, secret);
    const tampered = token.replace('sess-A', 'sess-VICTIM');
    expect(verifyState(tampered, secret)).toBeNull();
  });

  it('rejects malformed states', () => {
    expect(verifyState('', secret)).toBeNull();
    expect(verifyState('a:b', secret)).toBeNull();
    expect(verifyState(null, secret)).toBeNull();
  });
});
