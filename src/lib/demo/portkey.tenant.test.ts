// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatComplete, portkeyChatStream, visionComplete, modelFor, TASK_MODELS, VISION_FALLBACK_MODEL } from './portkey';
import { TENANT_TASK_MODELS, tenantModelFor } from './tenantModels';

// Every entry point picks its model AND key from the session it is handed.
// J&C runs on Claude (./tenantModels); everyone else stays on Gemini with the
// shared key. Fake key values only: these never leave the test.

const JC = '61400e73-0570-4167-88d9-d3a69650b15b';
const UNMAPPED = 'bbbbbbbb-0000-4000-8000-000000000002';
const img = { mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) };

const OLD = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

const okResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
const headersOf = (i = 0) => (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>;
const authOf = (i = 0) => headersOf(i).Authorization;
const providerOf = (i = 0) => headersOf(i)['x-portkey-provider'];
const bodyOf = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i][1] as RequestInit).body));
const urlOf = (i = 0) => String(fetchMock.mock.calls[i][0]);
const sentKeys = () => fetchMock.mock.calls.map((_, i) => authOf(i));

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'shared-test-key';
  process.env.GEMINI_API_KEY_CARSON = 'carson-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
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

describe('tenant model map', () => {
  it('puts J&C on Haiku for extract and Sonnet for assistant and vision', () => {
    expect(tenantModelFor(JC, 'extract')).toBe('anthropic/claude-haiku-5-5');
    expect(tenantModelFor(JC, 'assistant')).toBe('anthropic/claude-sonnet-5-5');
    expect(tenantModelFor(JC, 'vision')).toBe('anthropic/claude-sonnet-5-5');
    expect(tenantModelFor(` ${JC.toUpperCase()} `, 'extract')).toBe('anthropic/claude-haiku-5-5');
  });

  it('leaves everyone else, and unlisted classes, on TASK_MODELS', () => {
    expect(tenantModelFor(JC, 'reply')).toBeNull();
    expect(modelFor('reply', JC)).toBe(TASK_MODELS.reply);
    for (const s of [UNMAPPED, null, '', 'not-a-uuid', '__proto__', 'constructor']) {
      expect(tenantModelFor(s, 'extract')).toBeNull();
      expect(modelFor('extract', s)).toBe(TASK_MODELS.extract);
    }
  });

  it('is keyed by lowercase session uuids and uses creator/model ids', () => {
    for (const [session, models] of Object.entries(TENANT_TASK_MODELS)) {
      expect(session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      for (const id of Object.values(models)) expect(id).toMatch(/^(google|openai|anthropic)\/.+/);
    }
  });
});

describe('chatComplete routing', () => {
  it('sends J&C extract to Claude Haiku through Portkey on the Anthropic key, no Gemini params', async () => {
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: JC });
    expect(urlOf()).toBe('https://portkey.auto-mate.business/v1/chat/completions');
    expect(providerOf()).toBe('anthropic');
    expect(authOf()).toBe('Bearer anthropic-test-key');
    expect(bodyOf().model).toBe('claude-haiku-5-5');
    expect(bodyOf().reasoning_effort).toBeUndefined();
    expect(bodyOf().max_tokens).toBeGreaterThan(0);
  });

  it('keeps an unmapped tenant and no tenant on Gemini with the shared key', async () => {
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: UNMAPPED });
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: null });
    for (const i of [0, 1]) {
      expect(providerOf(i)).toBe('google');
      expect(authOf(i)).toBe('Bearer shared-test-key');
      expect(bodyOf(i).reasoning_effort).toBe('minimal');
    }
  });

  it('fails closed for J&C when ANTHROPIC_API_KEY is missing: no request, no other key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await chatComplete({ taskClass: 'extract', messages: msg, sessionId: JC })).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0][0])).toContain('ANTHROPIC_API_KEY');
    expect(String(log.mock.calls[0][0])).not.toContain('test-key');
  });

  it('never sends a J&C call on a Gemini key', async () => {
    await chatComplete({ taskClass: 'extract', messages: msg, sessionId: JC });
    await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: JC });
    await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(sentKeys()).not.toContain('Bearer shared-test-key');
    expect(sentKeys()).not.toContain('Bearer carson-test-key');
  });
});

describe('portkeyChatStream routing', () => {
  it('streams J&C assistant on Claude Sonnet with the Anthropic key', async () => {
    await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: JC });
    expect(providerOf()).toBe('anthropic');
    expect(authOf()).toBe('Bearer anthropic-test-key');
    expect(bodyOf()).toMatchObject({ model: 'claude-sonnet-5-5', stream: true });
    expect(bodyOf().reasoning_effort).toBeUndefined();
  });

  it('keeps an unmapped tenant on Gemini with the shared key', async () => {
    await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: UNMAPPED });
    expect(providerOf()).toBe('google');
    expect(authOf()).toBe('Bearer shared-test-key');
  });

  it('fails closed for J&C when ANTHROPIC_API_KEY is missing: non-ok, nothing sent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await portkeyChatStream({ taskClass: 'assistant', messages: msg, sessionId: JC });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('visionComplete routing', () => {
  it('reads a J&C photo on Claude Sonnet with the Anthropic key', async () => {
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r).toMatchObject({ ok: true, model: 'anthropic/claude-sonnet-5-5' });
    expect(providerOf()).toBe('anthropic');
    expect(authOf()).toBe('Bearer anthropic-test-key');
    expect(bodyOf().model).toBe('claude-sonnet-5-5');
  });

  it('keeps no tenant on Gemini with the shared key', async () => {
    await visionComplete({ prompt: 'p', images: [img], sessionId: null });
    expect(providerOf()).toBe('google');
    expect(authOf()).toBe('Bearer shared-test-key');
  });

  it('falls back to OpenAI when Claude is out of credit (a 400, not a 429)', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(
        JSON.stringify({ error: { message: 'Your credit balance is too low to access the Anthropic API.' } }),
        { status: 400 },
      )))
      .mockImplementationOnce(okResponse);
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r).toMatchObject({ ok: true, model: VISION_FALLBACK_MODEL });
    expect(providerOf(1)).toBe('openai');
    expect(authOf(1)).toBe('Bearer openai-test-key');
  });

  it('does not fall back on any other 400 from Claude', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('image too large', { status: 400 })));
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r).toMatchObject({ ok: false, kind: 'http' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed for J&C when ANTHROPIC_API_KEY is missing: config error, no OpenAI fallback, nothing sent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await visionComplete({ prompt: 'p', images: [img], sessionId: JC });
    expect(r).toMatchObject({ ok: false, kind: 'config', detail: 'ANTHROPIC_API_KEY is not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
