import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  formatPhone, describeLead,
  postcallOpenedEvent, postcallResolvedEvent, quoteOutcomeEvent,
  handoffSignalEvent, smsOutboundEvent,
  smsOutboundMessage, SMS_OUTBOUND_MESSAGE_TEMPLATE, JC_SESSION_ID,
} from './eventSources';

const S = 's-1';

describe('formatPhone', () => {
  it('formats a 10-digit US number', () => {
    expect(formatPhone('8018915463')).toBe('(801) 891-5463');
  });
  it('strips a leading country code', () => {
    expect(formatPhone('+18018915463')).toBe('(801) 891-5463');
  });
  it('ignores punctuation already present', () => {
    expect(formatPhone('(801) 891-5463')).toBe('(801) 891-5463');
  });
  it('leaves anything that is not a US number alone rather than half-formatting it', () => {
    expect(formatPhone('+442071838750')).toBe('+442071838750');
    expect(formatPhone('12345')).toBe('12345');
  });
  it('is null for no number', () => {
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone('')).toBeNull();
  });
});

describe('describeLead', () => {
  it('prefers the name', () => {
    expect(describeLead('Wes Bayles', '+18018915463')).toBe('Wes Bayles');
  });
  it('falls back to the formatted number', () => {
    expect(describeLead(null, '+18018915463')).toBe('(801) 891-5463');
    expect(describeLead('   ', '+18018915463')).toBe('(801) 891-5463');
  });
  it('falls back to a neutral label when there is neither', () => {
    expect(describeLead(null, null)).toBe('a new lead');
  });
});

describe('postcallOpenedEvent', () => {
  const base = { postcallId: 'pc1', sessionId: S, kind: 'call', phone: '+18012240797' };

  it('maps a fired post-call menu to a first_responder call event', () => {
    expect(postcallOpenedEvent({ ...base, openedAt: '2026-08-11T19:27:31.648906+00:00' })).toEqual({
      session_id: S,
      agent: 'first_responder',
      kind: 'call',
      message: 'Checked in after your call with (801) 224-0797',
      created_at: '2026-08-11T19:27:31.648Z',
      source_key: 'postcall:pc1:opened',
      lead_key: '8012240797',
    });
  });

  it('uses the lead name when the pipeline row has one', () => {
    const e = postcallOpenedEvent({ ...base, leadName: 'Ron Hobbs', openedAt: '2026-08-11T19:27:31Z' });
    expect(e?.message).toBe('Checked in after your call with Ron Hobbs');
  });

  // The voice workflow fires this on calls that were HANDLED. Labelling it
  // missed_call would both lie in the ticker and hand RescueRing a denominator
  // that is really its own numerator.
  it('never claims a missed call', () => {
    const e = postcallOpenedEvent({ ...base, openedAt: '2026-08-11T19:27:31Z' });
    expect(e?.kind).not.toBe('missed_call');
    expect(e?.message).not.toMatch(/missed/i);
  });

  it('emits nothing for a quote menu (only its outcome is client-facing)', () => {
    expect(postcallOpenedEvent({ ...base, kind: 'quote', openedAt: '2026-08-11T19:27:31Z' })).toBeNull();
  });

  it('emits nothing without a timestamp or a session', () => {
    expect(postcallOpenedEvent({ ...base, openedAt: null })).toBeNull();
    expect(postcallOpenedEvent({ ...base, openedAt: 'not a date' })).toBeNull();
    expect(postcallOpenedEvent({ ...base, sessionId: null, openedAt: '2026-08-11T19:27:31Z' })).toBeNull();
  });
});

describe('postcallResolvedEvent', () => {
  const base = {
    postcallId: 'pc1', sessionId: S, kind: 'call',
    phone: '+18012240797', resolvedAt: '2026-08-11T19:27:48.26+00:00',
  };

  it('1 is the onboarding form', () => {
    const e = postcallResolvedEvent({ ...base, choice: '1' });
    expect(e?.message).toBe('Sent (801) 224-0797 the onboarding form');
    expect(e?.kind).toBe('reply');
    expect(e?.source_key).toBe('postcall:pc1:resolved');
  });
  it('2 is the agent taking the conversation back', () => {
    expect(postcallResolvedEvent({ ...base, choice: '2' })?.message)
      .toBe('Picked the conversation with (801) 224-0797 back up');
  });
  it('3 is the FAQ', () => {
    expect(postcallResolvedEvent({ ...base, choice: '3' })?.message)
      .toBe('Sent (801) 224-0797 answers to the common questions');
  });
  it('4 emits nothing: nobody was contacted, so nothing happened to report', () => {
    expect(postcallResolvedEvent({ ...base, choice: '4' })).toBeNull();
  });
  it('emits nothing for notes-only replies (no choice)', () => {
    expect(postcallResolvedEvent({ ...base, choice: null })).toBeNull();
  });
  it('shares one dedupe key with the choice, so a re-sent reply cannot duplicate', () => {
    const a = postcallResolvedEvent({ ...base, choice: '1' });
    const b = postcallResolvedEvent({ ...base, choice: '1', resolvedAt: '2026-08-11T20:00:00Z' });
    expect(a?.source_key).toBe(b?.source_key);
  });
});

describe('quoteOutcomeEvent', () => {
  const base = {
    postcallId: 'pc9', sessionId: S, kind: 'quote',
    phone: '+18018915463', leadName: 'Wes Bayles', resolvedAt: '2026-08-16T03:15:04.407+00:00',
  };

  it('credits the cultivator, not the first responder', () => {
    expect(quoteOutcomeEvent({ ...base, choice: '1' })?.agent).toBe('cultivator');
  });
  it('1 won', () => {
    expect(quoteOutcomeEvent({ ...base, choice: '1' })).toMatchObject({
      kind: 'won', message: 'The estimate for Wes Bayles came back a win',
      source_key: 'postcall:pc9:quote',
    });
  });
  it('2 thinking', () => {
    expect(quoteOutcomeEvent({ ...base, choice: '2' })).toMatchObject({
      kind: 'followup', message: 'Wes Bayles is still deciding, follow ups are running',
    });
  });
  it('3 lost', () => {
    expect(quoteOutcomeEvent({ ...base, choice: '3' })).toMatchObject({
      kind: 'lost', message: 'Wes Bayles went another direction, closed it out',
    });
  });
  it('4 ignore changes nothing, so it emits nothing', () => {
    expect(quoteOutcomeEvent({ ...base, choice: '4' })).toBeNull();
  });
});

describe('handoffSignalEvent', () => {
  const base = { signalId: 'sig1', sessionId: S, at: '2026-08-17T18:00:00Z' };

  it('maps a handoff to the office', () => {
    expect(handoffSignalEvent({ ...base, kind: 'operator_flip' })).toEqual({
      session_id: S, agent: 'first_responder', kind: 'handoff',
      message: 'Handed the conversation over to your team',
      created_at: '2026-08-17T18:00:00.000Z',
      source_key: 'signal:sig1',
      // A handoff is not about a nameable lead.
      lead_key: null,
    });
  });
  it('maps the agent resuming', () => {
    expect(handoffSignalEvent({ ...base, kind: 'back_to_agent' })?.message)
      .toBe('Picked the conversation back up from your team');
  });
  // handoff_signals is also the sink for internal readiness pings from the e2e
  // preview page. A client must never see one of those in their ticker.
  it('emits nothing for an unrecognised (internal) signal kind', () => {
    expect(handoffSignalEvent({ ...base, kind: 'preview-ready' })).toBeNull();
    expect(handoffSignalEvent({ ...base, kind: null })).toBeNull();
  });
  it('emits nothing for a signal with no session or no id', () => {
    expect(handoffSignalEvent({ ...base, sessionId: null, kind: 'operator_flip' })).toBeNull();
    expect(handoffSignalEvent({ ...base, signalId: null, kind: 'operator_flip' })).toBeNull();
  });
});

describe('smsOutboundEvent', () => {
  it('maps the agent texting a lead back', () => {
    expect(smsOutboundEvent({
      fromNumber: '+18018915463', leadName: 'Wes Bayles',
      lastOutboundAt: '2026-08-11T21:44:47.4+00:00',
    })).toEqual({
      session_id: JC_SESSION_ID,
      agent: 'first_responder',
      kind: 'reply',
      message: 'Texted Wes Bayles',
      created_at: '2026-08-11T21:44:47.400Z',
      source_key: 'jcsms:+18018915463:out:2026-08-11T21:44:47.400Z',
      lead_key: '8018915463',
    });
  });

  it('falls back to the number when the agent has not extracted a name yet', () => {
    expect(smsOutboundEvent({
      fromNumber: '+13855208830', leadName: null, lastOutboundAt: '2026-08-10T14:45:02.946Z',
    })?.message).toBe('Texted (385) 520-8830');
  });

  // The dedupe key is the outbound TIMESTAMP, so the trigger firing repeatedly
  // on a row whose last_outbound_at has not moved writes exactly one line, and
  // a genuinely new text writes a new one.
  it('keys on the outbound timestamp, so re-firing on an unchanged row is a no-op', () => {
    const a = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-10T14:45:02.946Z' });
    const b = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-10T14:45:02.946Z' });
    const c = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-11T09:00:00.000Z' });
    expect(a?.source_key).toBe(b?.source_key);
    expect(a?.source_key).not.toBe(c?.source_key);
  });

  it('emits nothing when the agent has never sent anything', () => {
    expect(smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The SMS mapping lives in a DB trigger (n8n writes that table, not this app),
// so its wording is the one thing that could silently drift from this module.
// These assertions are the guard rail.
// ---------------------------------------------------------------------------

describe('sms trigger migration parity', () => {
  // Read the LATEST migration that defines the function, not a hardcoded file.
  // The wording moved from 0013 to 0014 when "back" was dropped; pinning the
  // filename would have kept this test green against a superseded definition,
  // which is the exact failure the parity test exists to catch.
  const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations');
  const DEFINES = 'create or replace function public.emit_jc_sms_client_event';
  const owning = readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => readFileSync(path.join(MIGRATIONS, f), 'utf8').includes(DEFINES))
    .pop();

  it('has exactly one migration owning the current definition', () => {
    expect(owning).toBeDefined();
  });

  const sql = readFileSync(path.join(MIGRATIONS, owning!), 'utf8');

  it('renders the same message template this module exports', () => {
    expect(SMS_OUTBOUND_MESSAGE_TEMPLATE).toBe('Texted %s');
    expect(sql).toContain(`format('${SMS_OUTBOUND_MESSAGE_TEMPLATE}', who)`);
  });

  it('builds the same source_key prefix', () => {
    const key = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-10T14:45:02.946Z' })!.source_key;
    expect(key.startsWith('jcsms:')).toBe(true);
    expect(sql).toContain(`'jcsms:' || p_from_number || ':out:'`);
  });

  it('stamps the key with the same ISO-8601 millisecond format', () => {
    // JS toISOString() and to_char(...'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') must
    // agree exactly, or the trigger and the backfill dedupe against each other.
    const key = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-10T14:45:02.946Z' })!.source_key;
    expect(key.endsWith('2026-08-10T14:45:02.946Z')).toBe(true);
    expect(sql).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);
  });

  it('agrees on agent and kind', () => {
    const e = smsOutboundEvent({ fromNumber: '+1385', lastOutboundAt: '2026-08-10T14:45:02.946Z' })!;
    expect([e.agent, e.kind]).toEqual(['first_responder', 'reply']);
    expect(sql).toContain(`'first_responder',\n      'reply',`);
  });

});

// The client_events SCHEMA was introduced by 0013 and is not re-declared by
// later migrations, so these stay pinned to that file. Only the function body
// above migrates forward.
describe('client_events schema (migration 0013)', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0013_client_events_sources.sql'),
    'utf8',
  );

  it('grants the table to service_role (a Management API migration skips the auto grant)', () => {
    expect(sql).toContain('grant all on public.client_events to service_role');
  });

  it('makes source_key uniquely indexed, non-partial, so PostgREST can infer it', () => {
    expect(sql).toContain('create unique index if not exists client_events_source_key_uq');
    expect(sql).not.toMatch(/client_events_source_key_uq[\s\S]{0,120}where/i);
  });
});

describe('ticker copy', () => {
  const samples = [
    postcallOpenedEvent({ postcallId: 'a', sessionId: S, kind: 'call', phone: '+18012240797', openedAt: '2026-08-11T19:27:31Z' }),
    postcallResolvedEvent({ postcallId: 'a', sessionId: S, kind: 'call', phone: '+18012240797', resolvedAt: '2026-08-11T19:27:48Z', choice: '1' }),
    postcallResolvedEvent({ postcallId: 'a', sessionId: S, kind: 'call', phone: '+18012240797', resolvedAt: '2026-08-11T19:27:48Z', choice: '2' }),
    postcallResolvedEvent({ postcallId: 'a', sessionId: S, kind: 'call', phone: '+18012240797', resolvedAt: '2026-08-11T19:27:48Z', choice: '3' }),
    quoteOutcomeEvent({ postcallId: 'b', sessionId: S, kind: 'quote', leadName: 'Wes', resolvedAt: '2026-08-16T03:15:04Z', choice: '1' }),
    quoteOutcomeEvent({ postcallId: 'b', sessionId: S, kind: 'quote', leadName: 'Wes', resolvedAt: '2026-08-16T03:15:04Z', choice: '2' }),
    quoteOutcomeEvent({ postcallId: 'b', sessionId: S, kind: 'quote', leadName: 'Wes', resolvedAt: '2026-08-16T03:15:04Z', choice: '3' }),
    handoffSignalEvent({ signalId: 'c', sessionId: S, kind: 'operator_flip', at: '2026-08-17T18:00:00Z' }),
    { message: smsOutboundMessage('Wes Bayles') },
  ];

  it('has no em dashes (brand rule)', () => {
    for (const s of samples) expect(s!.message).not.toContain('—');
  });

  it('carries no internal codenames', () => {
    for (const s of samples) {
      expect(s!.message).not.toMatch(/first_responder|cultivator|postcall|lead_postcall|jc_sms|session_id|n8n/i);
    }
  });
});
