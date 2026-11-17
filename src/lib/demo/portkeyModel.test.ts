// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';
import { finalizeEmptyToolArgs, portkeyLanguageModel } from './portkeyModel';

// Fake key values only: these never leave the test.

const OLD = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

const CREDIT_OUT = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
});
const completion = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'x', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
const sse = (content: string) =>
  new Response(
    [
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
// A raw SSE body delivered in fixed-size byte pieces, as a network read would.
const rawSse = (body: string, size: number) => {
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
};
const chunk = (choice: Record<string, unknown>) =>
  `data: ${JSON.stringify({ id: 'anthropic-1', object: 'chat.completion.chunk', created: 0, model: 'claude-sonnet-5-5', provider: 'anthropic', choices: [{ index: 0, logprobs: null, finish_reason: null, ...choice }] })}`;
const NO_ARG_TOOL_SSE = [
  'data: {"id":"anthropic-1794875515888","object":"chat.completion.chunk","created":1794875515,"model":"claude-sonnet-5-5","provider":"anthropic","choices":[{"delta":{"content":"","role":"assistant"},"index":0,"logprobs":null,"finish_reason":null}]}',
  'data: {"id":"anthropic-1794875515888","object":"chat.completion.chunk","created":1794875515,"model":"claude-sonnet-5-5","provider":"anthropic","choices":[{"delta":{"tool_calls":[{"index":0,"id":"toolu_01Bwr1S76AaDKTXtQjHZmq2k","type":"function","function":{"name":"showColorCard","arguments":""}}]},"index":0,"logprobs":null,"finish_reason":null}]}',
  'data: {"id":"anthropic-1794875515888","object":"chat.completion.chunk","created":1794875515,"model":"claude-sonnet-5-5","provider":"anthropic","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":""}}]},"index":0,"logprobs":null,"finish_reason":null}]}',
  'data: {"id":"anthropic-1794875515888","object":"chat.completion.chunk","created":1794875516,"model":"claude-sonnet-5-5","provider":"anthropic","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":387,"completion_tokens":28,"total_tokens":415,"prompt_tokens_details":{"cached_tokens":0}}}',
  'data: [DONE]',
  '',
  '',
].join('\n\n');
const headersOf = (i: number) => new Headers((fetchMock.mock.calls[i][1] as RequestInit).headers);
const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i][1] as RequestInit).body));

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  delete process.env.LLM_PORTKEY_BYPASS;
  delete process.env.PORTKEY_BASE_URL;
  process.env.PORTKEY_GATEWAY_KEY = 'gateway-test-key';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const model = () => {
  const m = portkeyLanguageModel('onboarding', null, 'onboarding');
  if (!m.ok) throw new Error(m.detail);
  return m;
};

describe('portkeyLanguageModel', () => {
  it('sends the onboarding class to Claude Sonnet through Portkey, with max_tokens and no temperature', async () => {
    fetchMock.mockResolvedValueOnce(completion('hi'));
    const m = model();
    const { text } = await generateText({ model: m.model, maxTokens: m.maxTokens, prompt: 'hello' });
    expect(text).toBe('hi');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://portkey.auto-mate.business/v1/chat/completions');
    const h = headersOf(0);
    expect(h.get('x-portkey-provider')).toBe('anthropic');
    expect(h.get('authorization')).toBe('Bearer anthropic-test-key');
    expect(h.get('x-amos-gateway-key')).toBe('gateway-test-key');
    expect(JSON.parse(h.get('x-portkey-metadata') ?? '{}')).toEqual({ app: 'mate-onboarding', surface: 'onboarding' });
    const body = bodyOf(0);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(m.maxTokens);
    // Claude 5.5 rejects temperature; the AI SDK would otherwise send 0.
    expect(body.temperature).toBeUndefined();
  });

  it('retries once on OpenAI when the Claude credit is spent (generate)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(CREDIT_OUT, { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(completion('from openai'));
    const m = model();
    const { text } = await generateText({ model: m.model, maxTokens: m.maxTokens, prompt: 'hello', maxRetries: 0 });
    expect(text).toBe('from openai');
    expect(headersOf(1).get('x-portkey-provider')).toBe('openai');
    expect(headersOf(1).get('authorization')).toBe('Bearer openai-test-key');
    expect(bodyOf(1).model).toBe('gpt-4o-mini');
  });

  it('retries once on OpenAI when the Claude credit is spent (stream), before any text', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(CREDIT_OUT, { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(sse('streamed by openai'));
    const m = model();
    const r = streamText({ model: m.model, maxTokens: m.maxTokens, prompt: 'hello', maxRetries: 0 });
    let text = '';
    for await (const d of r.textStream) text += d;
    expect(text).toBe('streamed by openai');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1).get('x-portkey-provider')).toBe('openai');
  });

  it('never falls back on success or on any other error', async () => {
    fetchMock.mockResolvedValueOnce(completion(''));
    const m = model();
    await generateText({ model: m.model, maxTokens: m.maxTokens, prompt: 'hello' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"bad"}}', { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(generateText({ model: m.model, maxTokens: m.maxTokens, prompt: 'hello', maxRetries: 0 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends tool definitions to Claude, runs the tool call, and sends the result back as step two', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'claude-sonnet-5-5',
        choices: [{
          index: 0,
          message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'saveField', arguments: '{"key":"phone","value":"801-555-0110"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(completion('Saved your phone.'));
    const saved: unknown[] = [];
    const m = model();
    const { text, steps } = await generateText({
      model: m.model, maxTokens: m.maxTokens, maxSteps: 3, prompt: 'Our phone is 801-555-0110',
      tools: {
        saveField: tool({
          description: 'Save one collected field',
          parameters: z.object({ key: z.string(), value: z.string() }),
          execute: async args => { saved.push(args); return 'ok'; },
        }),
      },
    });

    // Step 1: the tool definition went to Claude in the gateway's OpenAI shape.
    const first = bodyOf(0);
    expect(headersOf(0).get('x-portkey-provider')).toBe('anthropic');
    expect(first.model).toBe('claude-sonnet-5-5');
    expect(first.tools).toEqual([{
      type: 'function',
      function: {
        name: 'saveField',
        description: 'Save one collected field',
        parameters: expect.objectContaining({ type: 'object', required: ['key', 'value'] }),
      },
    }]);
    expect(first.temperature).toBeUndefined();

    // The tool ran with the model's arguments.
    expect(saved).toEqual([{ key: 'phone', value: '801-555-0110' }]);

    // Step 2: the call and its result went back to the same model.
    const second = bodyOf(1);
    expect(headersOf(1).get('x-portkey-provider')).toBe('anthropic');
    expect(second.model).toBe('claude-sonnet-5-5');
    expect(second.temperature).toBeUndefined();
    const assistant = second.messages.find((x: { role: string }) => x.role === 'assistant');
    expect(assistant.tool_calls[0]).toMatchObject({ id: 'toolu_1', function: { name: 'saveField' } });
    expect(second.messages.find((x: { role: string }) => x.role === 'tool')).toMatchObject({ tool_call_id: 'toolu_1', content: '"ok"' });

    expect(steps).toHaveLength(2);
    expect(text).toBe('Saved your phone.');
  });

  it('streams a no-argument tool call (Portkey sends arguments "") and goes on to step two', async () => {
    // Byte for byte what the gateway streamed for Claude calling a no-argument
    // tool on 2026-11-16: arguments "" twice, then only the finish chunk.
    // Handed over in 37-byte pieces so events and lines split across reads.
    fetchMock
      .mockResolvedValueOnce(rawSse(NO_ARG_TOOL_SSE, 37))
      .mockResolvedValueOnce(sse('Here are your colors.'));
    let shown = 0;
    const m = model();
    const r = streamText({
      model: m.model, maxTokens: m.maxTokens, maxSteps: 3, prompt: 'Show me the color card',
      tools: {
        showColorCard: tool({
          description: 'Show the color card',
          parameters: z.object({}),
          execute: async () => { shown++; return { shown: true }; },
        }),
      },
    });
    await r.consumeStream();
    const steps = await r.steps;

    expect(shown).toBe(1);
    expect(steps[0].finishReason).toBe('tool-calls');
    expect(steps[0].toolCalls).toMatchObject([{ toolCallId: 'toolu_01Bwr1S76AaDKTXtQjHZmq2k', toolName: 'showColorCard', args: {} }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const assistant = bodyOf(1).messages.find((x: { role: string }) => x.role === 'assistant');
    expect(assistant.tool_calls[0]).toMatchObject({ id: 'toolu_01Bwr1S76AaDKTXtQjHZmq2k', function: { name: 'showColorCard', arguments: '{}' } });
    expect(await r.text).toBe('Here are your colors.');
  });

  it('leaves a streamed tool call with real arguments, and a text stream, byte for byte alone', async () => {
    const withArgs = [
      chunk({ delta: { role: 'assistant', content: '' } }),
      chunk({ delta: { tool_calls: [{ index: 0, id: 'toolu_2', type: 'function', function: { name: 'saveField', arguments: '' } }] } }),
      chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: '{"key":"pho' } }] } }),
      chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: 'ne","value":"801"}' } }] } }),
      chunk({ delta: {}, finish_reason: 'tool_calls' }),
      'data: [DONE]',
    ].map(e => `${e}\n\n`).join('');
    const text = [chunk({ delta: { content: 'hi' } }), chunk({ delta: {}, finish_reason: 'stop' }), 'data: [DONE]']
      .map(e => `${e}\n\n`).join('');
    for (const body of [withArgs, text]) {
      expect(await new Response(finalizeEmptyToolArgs(rawSse(body, 5).body!)).text()).toBe(body);
    }

    fetchMock.mockResolvedValueOnce(rawSse(withArgs, 11)).mockResolvedValueOnce(sse('Saved.'));
    const saved: unknown[] = [];
    const m = model();
    const r = streamText({
      model: m.model, maxTokens: m.maxTokens, maxSteps: 3, prompt: 'phone 801',
      tools: {
        saveField: tool({
          description: 'Save one collected field',
          parameters: z.object({ key: z.string(), value: z.string() }),
          execute: async args => { saved.push(args); return 'ok'; },
        }),
      },
    });
    await r.consumeStream();
    expect(saved).toEqual([{ key: 'phone', value: '801' }]);
    expect(await r.text).toBe('Saved.');
  });

  it('closes an empty call when the stream ends with no finish chunk and no blank line', async () => {
    const cut = chunk({ delta: { tool_calls: [{ index: 0, id: 'toolu_3', type: 'function', function: { name: 'showChannelsCard', arguments: '' } }] } });
    const out = await new Response(finalizeEmptyToolArgs(rawSse(cut, 64).body!)).text();
    expect(out.startsWith(`${cut}\n\ndata: `)).toBe(true);
    const added = JSON.parse(out.slice(`${cut}\n\ndata: `.length));
    expect(added.choices[0].delta.tool_calls).toEqual([{ index: 0, function: { arguments: '{}' } }]);
  });

  it('refuses when ANTHROPIC_API_KEY is missing, naming the variable', () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(portkeyLanguageModel('onboarding', null)).toEqual({ ok: false, detail: 'ANTHROPIC_API_KEY is not set' });
  });
});
