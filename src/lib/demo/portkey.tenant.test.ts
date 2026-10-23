// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatComplete, portkeyChatStream, visionComplete } from './portkey';

// Every Gemini entry point picks its key from the session it is handed. Fake
// key values only: these never leave the test.

const JC = '61400e73-0570-4167-88d9-d3a69650b15b';
const UNMAPPED = 'bbbbbbbb-0000-4000-8000-000000000002';
const img = { mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) };

const OLD = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

const okResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
const authOf = (i = 0) => ((fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>).Authorization;
const providerOf = (i = 0) =>
  ((fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>)['x-portkey-provider'];
const urlOf = (i = 0) => String(fetchMock.mock.calls[i][0]);

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'shared-test-key';
  process.env.GEMINI_API_KEY_CARSON = 'carson-test-key';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  delete process.env.LLM_PORTKEY_BYPASS;
  delete process.env.PORTKEY_BASE_URL;
  delete process.env.PORTKEY_GATEWAY_KEY;
  fetchMock = vi.fn(okResponse);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const msg = [{ role: 'user' as const, content: 'hi' }];

describe('chatComplete key selection', () => {
  it('uses the Carson key for J&C, still through Portkey as google', async () => {
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: JC });
    expect(authOf()).toBe('Bearer carson-test-key');
    expect(providerOf()).toBe('google');
    expect(urlOf()).toBe('https://portkey.auto-mate.business/v1/chat/completions');
  });

  it('uses the shared key for an unmapped tenant and for no tenant', async () => {
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: UNMAPPED });
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: null });
    expect(authOf(0)).toBe('Bearer shared-test-key');
    expect(authOf(1)).toBe('Bearer shared-test-key');
  });

  it('fails closed for J&C when its key is missing: no request at all', async () => {
    delete process.env.GEMINI_API_KEY_CARSON;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await chatComplete({ taskClass: 'extract', messages: msg, sessionId: JC })).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0][0])).toContain('GEMINI_API_KEY_CARSON');
  });
});

describe('portkeyChatStream key selection', () => {
  it('uses the Carson key for J&C', async () => {
    await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: JC });
    expect(authOf()).toBe('Bearer carson-test-key');
  });

  it('uses the shared key for an unmapped tenant', async () => {
    await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: UNMAPPED });
    expect(authOf()).toBe('Bearer shared-test-key');
  });

  it('fails closed for J&C when its key is missing: non-ok, nothing sent', async () => {
    delete process.env.GEMINI_API_KEY_CARSON;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: JC });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('visionComplete key selection', () => {
  it('uses the Carson key for J&C', async () => {
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r.ok).toBe(true);
    expect(authOf()).toBe('Bearer carson-test-key');
  });

  it('uses the shared key for no tenant', async () => {
    await visionComplete({ prompt: 'p', images: [img], sessionId: null });
    expect(authOf()).toBe('Bearer shared-test-key');
  });

  it('fails closed for J&C when its key is missing: config error, no OpenAI fallback, nothing sent', async () => {
    delete process.env.GEMINI_API_KEY_CARSON;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r).toMatchObject({ ok: false, kind: 'config', detail: 'GEMINI_API_KEY_CARSON is not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
