import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_TOKEN_HEADER, agentAuthed } from './agentAuth';

const HEADER_TOKEN = '<header-token-fixture-1>';
const LEGACY_TOKEN = '<legacy-token-fixture-2>';

const req = (qs = '', headers: Record<string, string> = {}) =>
  new Request(`http://x/api/agent/postcall${qs ? `?${qs}` : ''}`, { method: 'POST', headers });

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { MATE_AGENT_TOKEN: process.env.MATE_AGENT_TOKEN, AGENT_WEBHOOK_TOKEN: process.env.AGENT_WEBHOOK_TOKEN };
  process.env.MATE_AGENT_TOKEN = HEADER_TOKEN;
  process.env.AGENT_WEBHOOK_TOKEN = LEGACY_TOKEN;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('agentAuthed', () => {
  it('accepts the header token', () => {
    expect(agentAuthed(req('action=fire', { [AGENT_TOKEN_HEADER]: HEADER_TOKEN }))).toBe(true);
  });

  it('refuses a wrong, empty or missing header token', () => {
    expect(agentAuthed(req('action=fire', { [AGENT_TOKEN_HEADER]: '<header-token-fixture-9>' }))).toBe(false);
    expect(agentAuthed(req('action=fire', { [AGENT_TOKEN_HEADER]: '' }))).toBe(false);
    expect(agentAuthed(req('action=fire'))).toBe(false);
  });

  it('refuses tokens of a different length, shorter or longer', () => {
    expect(agentAuthed(req('', { [AGENT_TOKEN_HEADER]: HEADER_TOKEN.slice(0, -1) }))).toBe(false);
    expect(agentAuthed(req('', { [AGENT_TOKEN_HEADER]: `${HEADER_TOKEN}x` }))).toBe(false);
    expect(agentAuthed(req('', { [AGENT_TOKEN_HEADER]: 'x' }))).toBe(false);
    expect(agentAuthed(req(`k=${LEGACY_TOKEN.slice(1)}`))).toBe(false);
  });

  it('never accepts the header token in the URL', () => {
    expect(agentAuthed(req(`action=fire&k=${HEADER_TOKEN}`))).toBe(false);
  });

  it('accepts the legacy query token only while AGENT_WEBHOOK_TOKEN is set', () => {
    expect(agentAuthed(req(`action=fire&k=${LEGACY_TOKEN}`))).toBe(true);
    delete process.env.AGENT_WEBHOOK_TOKEN;
    expect(agentAuthed(req(`action=fire&k=${LEGACY_TOKEN}`))).toBe(false);
  });

  it('does not accept the legacy token as the header', () => {
    expect(agentAuthed(req('action=fire', { [AGENT_TOKEN_HEADER]: LEGACY_TOKEN }))).toBe(false);
  });

  it('turns the query path off when both env values are equal', () => {
    process.env.AGENT_WEBHOOK_TOKEN = HEADER_TOKEN;
    expect(agentAuthed(req(`action=fire&k=${HEADER_TOKEN}`))).toBe(false);
    expect(agentAuthed(req('', { [AGENT_TOKEN_HEADER]: HEADER_TOKEN }))).toBe(true);
  });

  it('refuses everything with neither token configured', () => {
    delete process.env.MATE_AGENT_TOKEN;
    delete process.env.AGENT_WEBHOOK_TOKEN;
    expect(agentAuthed(req('k=', { [AGENT_TOKEN_HEADER]: '' }))).toBe(false);
    expect(agentAuthed(req('k=anything'))).toBe(false);
  });
});
