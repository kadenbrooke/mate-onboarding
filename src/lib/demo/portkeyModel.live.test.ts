// @vitest-environment node
//
// Live check through the real Portkey gateway against Claude: a tool that takes
// no arguments must reach execute and the turn must go on to a text reply.
// Skipped unless MATE_PORTKEY_LIVE=1, so `npm test` never calls the network.
// Run (from the amos repo's secret helper, values never printed):
//   node ~/kaden/amos/scripts/secrets/secret.mjs run -e ANTHROPIC_API_KEY -e PORTKEY_GATEWAY_KEY -e OPENAI_API_KEY -- \
//     env MATE_PORTKEY_LIVE=1 npx vitest run src/lib/demo/portkeyModel.live.test.ts
import { describe, it, expect } from 'vitest';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { portkeyLanguageModel } from './portkeyModel';

const live = process.env.MATE_PORTKEY_LIVE === '1';

describe.skipIf(!live)('portkeyLanguageModel live (Portkey -> Claude)', () => {
  it('runs a no-argument tool and then answers in text', async () => {
    const m = portkeyLanguageModel('onboarding', null, 'live-check');
    if (!m.ok) throw new Error(m.detail);
    expect(m.modelId.startsWith('anthropic/')).toBe(true);

    let executed = 0;
    const result = streamText({
      model: m.model,
      maxTokens: m.maxTokens,
      system:
        'You are a test assistant. When the user asks for the ping card, call the showPingCard tool first, ' +
        'then after it returns reply with one short sentence that says the card is shown.',
      prompt: 'Show me the ping card please.',
      tools: {
        showPingCard: tool({
          description: 'Show the ping card to the user. Takes no arguments.',
          parameters: z.object({}),
          execute: async () => {
            executed++;
            return { shown: true };
          },
        }),
      },
      maxSteps: 3,
    });

    // streamText only settles its promises once something drains the stream.
    await result.consumeStream();
    const text = await result.text;
    const steps = await result.steps;
    console.log(
      '[live]',
      JSON.stringify({
        model: m.modelId,
        executed,
        steps: steps.map((s) => ({ finishReason: s.finishReason, tools: s.toolCalls.map((c) => [c.toolName, c.args]) })),
        text,
      }),
    );
    expect(executed).toBe(1);
    expect(steps[0].toolCalls.map((c) => c.toolName)).toEqual(['showPingCard']);
    expect(steps[0].toolCalls[0].args).toEqual({});
    expect(text.trim().length).toBeGreaterThan(0);
  }, 60_000);
});
