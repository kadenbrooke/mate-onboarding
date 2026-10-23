import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  geminiKeyEnvFor,
  resolveGeminiKey,
  SHARED_GEMINI_KEY_ENV,
  TENANT_GEMINI_KEY_ENV,
} from './geminiKey';
import { DEMO_SESSION_ID } from '@/lib/portal/demo';

const JC = '61400e73-0570-4167-88d9-d3a69650b15b';
const UNMAPPED = 'bbbbbbbb-0000-4000-8000-000000000002';

afterEach(() => vi.restoreAllMocks());

describe('geminiKeyEnvFor (mapping)', () => {
  it('puts J&C on the Carson key', () => {
    expect(geminiKeyEnvFor(JC)).toBe('GEMINI_API_KEY_CARSON');
  });

  it('matches the session id case-insensitively and ignores surrounding space', () => {
    expect(geminiKeyEnvFor(` ${JC.toUpperCase()} `)).toBe('GEMINI_API_KEY_CARSON');
  });

  it('falls back to the shared key for an unmapped tenant, no tenant, and junk', () => {
    expect(geminiKeyEnvFor(UNMAPPED)).toBe(SHARED_GEMINI_KEY_ENV);
    expect(geminiKeyEnvFor(null)).toBe(SHARED_GEMINI_KEY_ENV);
    expect(geminiKeyEnvFor('')).toBe(SHARED_GEMINI_KEY_ENV);
    expect(geminiKeyEnvFor('not-a-uuid')).toBe(SHARED_GEMINI_KEY_ENV);
    expect(geminiKeyEnvFor('__proto__')).toBe(SHARED_GEMINI_KEY_ENV);
  });

  it('keeps the public demo dashboard on the shared key', () => {
    expect(geminiKeyEnvFor(DEMO_SESSION_ID)).toBe(SHARED_GEMINI_KEY_ENV);
    expect(TENANT_GEMINI_KEY_ENV[DEMO_SESSION_ID]).toBeUndefined();
  });

  it('maps to env var NAMES only, keyed by lowercase session uuids', () => {
    for (const [session, envName] of Object.entries(TENANT_GEMINI_KEY_ENV)) {
      expect(session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(envName).toMatch(/^GEMINI_API_KEY_[A-Z0-9_]+$/);
    }
  });
});

describe('resolveGeminiKey', () => {
  const env = { GEMINI_API_KEY: 'shared-test', GEMINI_API_KEY_CARSON: 'carson-test' };

  it('returns the tenant key for a mapped tenant', () => {
    expect(resolveGeminiKey(JC, env)).toEqual({ ok: true, key: 'carson-test', envName: 'GEMINI_API_KEY_CARSON' });
  });

  it('returns the shared key for an unmapped tenant and for no tenant', () => {
    expect(resolveGeminiKey(UNMAPPED, env)).toEqual({ ok: true, key: 'shared-test', envName: 'GEMINI_API_KEY' });
    expect(resolveGeminiKey(null, env)).toEqual({ ok: true, key: 'shared-test', envName: 'GEMINI_API_KEY' });
    expect(resolveGeminiKey(DEMO_SESSION_ID, env)).toEqual({ ok: true, key: 'shared-test', envName: 'GEMINI_API_KEY' });
  });

  it('keeps the shared path unchanged when GEMINI_API_KEY is unset (empty key, not a refusal)', () => {
    expect(resolveGeminiKey(null, {})).toEqual({ ok: true, key: '', envName: 'GEMINI_API_KEY' });
  });

  it('fails closed for a mapped tenant whose key is missing, never falling back to the shared key', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = resolveGeminiKey(JC, { GEMINI_API_KEY: 'shared-test' });
    expect(r).toEqual({ ok: false, envName: 'GEMINI_API_KEY_CARSON' });
    expect(JSON.stringify(r)).not.toContain('shared-test');
    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('GEMINI_API_KEY_CARSON');
    expect(line).not.toContain('shared-test');
  });

  it('treats a blank mapped key as missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveGeminiKey(JC, { GEMINI_API_KEY: 'shared-test', GEMINI_API_KEY_CARSON: '  ' }).ok).toBe(false);
  });

  it('never logs a key value on success', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveGeminiKey(JC, env);
    expect(log).not.toHaveBeenCalled();
  });
});
