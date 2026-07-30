import { describe, it, expect, vi } from 'vitest';
const insertMock = vi.fn(() => Promise.resolve({ error: null }));
const client = { from: vi.fn(() => ({ insert: insertMock })) };
import { logMessage } from './messages';

describe('logMessage', () => {
  it('inserts a normalized lead_messages row', async () => {
    await logMessage(client as never, {
      leadId: 'lead-1', sessionId: 's1', direction: 'outbound', author: 'human', body: 'hi',
    });
    expect(client.from).toHaveBeenCalledWith('lead_messages');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-1', session_id: 's1', direction: 'outbound', author: 'human', channel: 'sms', body: 'hi',
    }));
  });
  it('defaults channel to sms and allows override', async () => {
    insertMock.mockClear();
    await logMessage(client as never, {
      leadId: 'l', sessionId: 's', direction: 'inbound', author: 'human', body: 'notes', channel: 'call_note',
    });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ channel: 'call_note' }));
  });
});
