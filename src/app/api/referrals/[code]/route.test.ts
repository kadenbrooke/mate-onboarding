import { describe, expect, it } from 'vitest';
import { referralCaptureResponse } from './route';

async function body(response: Response) {
  return { status: response.status, json: await response.json() };
}

describe('referral capture response privacy', () => {
  it('uses the same generic success for created, duplicate, and self-referral results', async () => {
    const results = await Promise.all([
      body(referralCaptureResponse({ kind: 'created', lead: { id: 'secret-lead' } as never })),
      body(referralCaptureResponse({ kind: 'duplicate', leadId: 'secret-lead' })),
      body(referralCaptureResponse({ kind: 'self-referral' })),
    ]);
    expect(results).toEqual([
      { status: 201, json: { ok: true } },
      { status: 201, json: { ok: true } },
      { status: 201, json: { ok: true } },
    ]);
    expect(JSON.stringify(results)).not.toContain('secret-lead');
  });
});
