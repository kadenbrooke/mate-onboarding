import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const maybeSingle = vi.fn();
const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
function tableStub() {
  return {
    select: () => ({ eq: () => ({ maybeSingle }) }),
    update,
  };
}
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: () => tableStub() }) }));

import { POST } from './route';

const secret = 'whsec_test';
beforeEach(() => {
  process.env.CALCOM_WEBHOOK_SECRET = secret;
  maybeSingle.mockReset();
  update.mockClear();
  updateEq.mockClear();
});

function req(bodyObj: unknown, sign = true) {
  const raw = JSON.stringify(bodyObj);
  const sig = sign ? createHmac('sha256', secret).update(raw, 'utf8').digest('hex') : 'deadbeef';
  return new Request('http://x/api/webhooks/calcom', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cal-signature-256': sig },
    body: raw,
  }) as never;
}

const booking = (over: Record<string, unknown> = {}) => ({
  triggerEvent: 'BOOKING_CREATED',
  payload: { uid: 'bk_1', endTime: '2026-08-06T17:30:00.000Z', attendees: [{ email: 'l@x.com', phoneNumber: '+18015551234' }], ...over },
});

describe('POST /api/webhooks/calcom', () => {
  it('401s on an invalid signature', async () => {
    const res = await POST(req(booking(), false));
    expect(res.status).toBe(401);
  });

  it('books a matched quote appointment, exits the drip, and updates by from_number (table has no id column)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { from_number: '+18015551234', status: 'engaged', calcom_booking_uid: null }, error: null });
    const res = await POST(req(booking()));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, matched: true, status: 'quote_booked' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'quote_booked', campaign: 'none', next_drip_due_at: null }));
    // Regression guard: jc_sms_conversations has no `id` column -- from_number is the
    // key. A prior version keyed the update on a nonexistent `id` and silently no-op'd
    // (Postgres 42703), so the webhook never actually updated anything in production.
    expect(updateEq).toHaveBeenCalledWith('from_number', '+18015551234');
  });

  it('is idempotent on a repeated cal.com uid', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { from_number: '+18015551234', status: 'quote_booked', calcom_booking_uid: 'bk_1' }, error: null });
    const res = await POST(req(booking()));
    const json = await res.json();
    expect(json).toMatchObject({ deduped: true });
    expect(update).not.toHaveBeenCalled();
  });

  it('no-ops when no conversation matches', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(req(booking()));
    const json = await res.json();
    expect(json).toMatchObject({ matched: false });
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores non-booking events', async () => {
    const res = await POST(req({ triggerEvent: 'PING', payload: {} }));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, ignored: 'PING' });
  });
});
