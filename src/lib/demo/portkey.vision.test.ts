// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { visionComplete, VISION_FALLBACK_MODEL, TASK_MODELS } from './portkey';

// The reader must survive its primary provider being down. On 2026-09-11 the
// Gemini key returned 429 (prepay credits depleted) and would have turned
// every upload into "could not read that photo". These pin the fallback.

const img = { mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) };
let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400, status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}
const okBody = (text: string) => ({ choices: [{ message: { content: text } }] });
const modelOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)).model;
const providerOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['x-portkey-provider'];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  process.env.GEMINI_API_KEY = 'g';
  process.env.OPENAI_API_KEY = 'o';
});
afterEach(() => vi.unstubAllGlobals());

describe('visionComplete fallback', () => {
  it('uses the primary model when it answers', async () => {
    fetchMock.mockImplementationOnce(() => reply(200, okBody('{"candidates":[]}')));
    const r = await visionComplete({ prompt: 'p', images: [img] });
    expect(r).toMatchObject({ ok: true, text: '{"candidates":[]}', model: TASK_MODELS.vision });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(providerOf(fetchMock.mock.calls[0])).toBe('google');
  });

  it('falls back to OpenAI on a 429 from the primary', async () => {
    fetchMock
      .mockImplementationOnce(() => reply(429, { error: { message: 'prepayment credits are depleted' } }))
      .mockImplementationOnce(() => reply(200, okBody('{"candidates":[{"name":"A"}]}')));
    const r = await visionComplete({ prompt: 'p', images: [img] });
    expect(r).toMatchObject({ ok: true, model: VISION_FALLBACK_MODEL });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(providerOf(fetchMock.mock.calls[1])).toBe('openai');
    expect(modelOf(fetchMock.mock.calls[1])).toBe('gpt-4o-mini');
  });

  it('falls back on a 5xx and on a transport failure', async () => {
    fetchMock
      .mockImplementationOnce(() => reply(503, 'gateway down'))
      .mockImplementationOnce(() => reply(200, okBody('x')));
    expect((await visionComplete({ prompt: 'p', images: [img] })).ok).toBe(true);

    fetchMock.mockReset();
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNRESET')))
      .mockImplementationOnce(() => reply(200, okBody('x')));
    expect((await visionComplete({ prompt: 'p', images: [img] })).ok).toBe(true);
  });

  it('does NOT fall back on a 400: a bad request is our bug, not the provider', async () => {
    fetchMock.mockImplementationOnce(() => reply(400, 'bad image'));
    const r = await visionComplete({ prompt: 'p', images: [img] });
    expect(r).toMatchObject({ ok: false, kind: 'http' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on an empty answer', async () => {
    fetchMock.mockImplementationOnce(() => reply(200, okBody('')));
    const r = await visionComplete({ prompt: 'p', images: [img] });
    expect(r).toMatchObject({ ok: false, kind: 'empty' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the fallback failure when both are down', async () => {
    fetchMock
      .mockImplementationOnce(() => reply(429, 'depleted'))
      .mockImplementationOnce(() => reply(502, 'also down'));
    const r = await visionComplete({ prompt: 'p', images: [img] });
    expect(r).toMatchObject({ ok: false, kind: 'http', model: VISION_FALLBACK_MODEL });
    expect(r.ok === false && r.detail.startsWith('502')).toBe(true);
  });

  it('sends the image as a data URL with the sniffed mime', async () => {
    fetchMock.mockImplementationOnce(() => reply(200, okBody('x')));
    await visionComplete({ prompt: 'p', images: [img] });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});
