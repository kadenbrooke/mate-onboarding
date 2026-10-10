import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendSms, insertedMessages } = vi.hoisted(() => ({
  sendSms: vi.fn(async () => ({ ok: true })),
  insertedMessages: [] as Record<string, unknown>[],
}));

function builder(table: string) {
  const query: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: () => chain,
    lte: () => chain,
    not: () => chain,
    maybeSingle: async () => {
      if (table === 'onboarding_sessions') {
        return { data: { operator_phone: '+18015550199', is_practice: true }, error: null };
      }
      if (table === 'lead_postcall') return { data: null, error: null };
      if (table === 'client_leads') return { data: { id: 'practice-lead-1' }, error: null };
      return { data: null, error: null };
    },
    insert: (values: Record<string, unknown>) => {
      if (table === 'lead_messages') insertedMessages.push(values);
      return Promise.resolve({ error: null });
    },
    then: (resolve: (value: unknown) => unknown) => {
      if (table === 'jc_sms_conversations') {
        return Promise.resolve({ data: [{ from_number: '+18015550101' }], error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  Object.assign(query, chain);
  return query;
}

vi.mock('@/lib/supabase/service', () => {
  const m = {
  createServiceClient: () => ({ from: (table: string) => builder(table) }),
};
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/agent/telnyx', () => ({ sendSms }));
vi.mock('@/lib/agent/quietHours', () => ({
  isWithinSendWindow: () => true,
}));

import { POST } from './route';

beforeEach(() => {
  process.env.AGENT_WEBHOOK_TOKEN = 'practice-token';
  process.env.JC_ONBOARDING_SESSION_ID = 'practice-session';
  sendSms.mockClear();
  insertedMessages.length = 0;
});

describe('POST /api/agent/quote-scan', () => {
  it('records a marked fake practice menu without calling the real provider', async () => {
    const response = await POST(new Request(
      'http://x/api/agent/quote-scan?k=practice-token',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
    expect(insertedMessages).toContainEqual(expect.objectContaining({
      lead_id: 'practice-lead-1',
      session_id: 'practice-session',
      direction: 'outbound',
      body: expect.stringContaining('[Practice fake sent to office]'),
    }));
  });
});
