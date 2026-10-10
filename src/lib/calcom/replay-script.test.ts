// scripts/replay-held-calcom.mjs: the reconcile path for held bookings.
import { describe, expect, it, vi } from 'vitest';
import { verifyCalcomSignature } from './verify';
import { alertState, parseArgs, replayOutcome, replayRow, signBody } from '../../../scripts/replay-held-calcom.mjs';

describe('replay-held-calcom', () => {
  it('re-signs the stored body exactly as cal.com does', () => {
    const raw = '{"triggerEvent":"BOOKING_CREATED","payload":{"uid":"bk"}}';
    expect(verifyCalcomSignature(raw, signBody(raw, 's3cret'), 's3cret')).toBe(true);
  });

  it('posts the held body with only content-type and the signature, never following redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true,"matched":false}', { status: 200 }));
    const row = { raw_body: '{"a":1}' };
    expect(await replayRow(row, { target: 'https://client.example.com', secret: 's', fetchImpl })).toEqual({ ok: true, status: 200, outcome: 'applied' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://client.example.com/api/webhooks/calcom');
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}', redirect: 'manual' });
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-cal-signature-256': signBody('{"a":1}', 's') });
  });

  it('only an applied or forwarded answer counts', () => {
    expect(replayOutcome(200, { ok: true, matched: true, status: 'quote_booked' })).toBe('applied');
    expect(replayOutcome(200, { ok: true, matched: true, deduped: true })).toBe('applied');
    expect(replayOutcome(200, { ok: true, matched: false })).toBe('applied');
    expect(replayOutcome(200, { ok: true, forwarded: true })).toBe('forwarded');
    expect(replayOutcome(202, { ok: true, held: true, duplicate: false })).toBe('held');
    expect(replayOutcome(200, { ok: true, ignored: 'PING' })).toBe('ignored');
    expect(replayOutcome(200, { ok: true })).toBe('unexpected');
    expect(replayOutcome(200, null)).toBe('failed');
    expect(replayOutcome(503, { held: true })).toBe('failed');
  });

  it('a 2xx that is not an applied answer does not resolve', async () => {
    const fetchImpl = async () => new Response('{"ok":true,"held":true,"duplicate":false}', { status: 202 });
    expect(await replayRow({ raw_body: '{}' }, { target: 'https://c.example', secret: 's', fetchImpl }))
      .toEqual({ ok: false, status: 202, outcome: 'held' });
    const notJson = async () => new Response('ok', { status: 200 });
    expect(await replayRow({ raw_body: '{}' }, { target: 'https://c.example', secret: 's', fetchImpl: notJson }))
      .toEqual({ ok: false, status: 200, outcome: 'failed' });
  });

  it('a non-2xx or a network error is not a success', async () => {
    expect(await replayRow({ raw_body: '{}' }, { target: 'https://c.example', secret: 's', fetchImpl: async () => new Response('', { status: 307 }) }))
      .toMatchObject({ ok: false, status: 307 });
    expect(await replayRow({ raw_body: '{}' }, { target: 'https://c.example', secret: 's', fetchImpl: async () => { throw new TypeError('x'); } }))
      .toMatchObject({ ok: false, status: 0 });
  });

  it('reports each held row\'s alert from the outbox', () => {
    expect(alertState(undefined)).toBe('NONE');
    expect(alertState({ source: 'mate:calcom-held:abc' })).toBe('queued');
  });

  it('validates arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--replay', 'abcd', '--target', 'https://c.example/', '--apply'])).toEqual({ apply: true, replay: 'abcd', target: 'https://c.example' });
    expect(() => parseArgs(['--replay', 'abcd'])).toThrow(/--target/);
    expect(() => parseArgs(['--replay', 'abcd', '--target', 'http://c.example'])).toThrow(/https/);
    expect(() => parseArgs(['--replay', 'abcd', '--target', 'https://c.example/x'])).toThrow(/bare/);
    expect(() => parseArgs(['--resolve', 'abcd'])).toThrow(/--note/);
    expect(() => parseArgs(['--replay', 'a', '--resolve', 'b', '--target', 'https://c.example'])).toThrow(/separate/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown/);
  });
});
