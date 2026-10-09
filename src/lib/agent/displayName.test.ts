import { describe, expect, it } from 'vitest';
import { agentDisplayNameForSession } from './displayName';

describe('agentDisplayNameForSession', () => {
  it('uses Ashley for the J&C tenant', () => {
    expect(agentDisplayNameForSession('61400e73-0570-4167-88d9-d3a69650b15b')).toBe('Ashley');
  });

  it('defaults other tenants and the demo to Mate', () => {
    expect(agentDisplayNameForSession('practice-session')).toBe('Mate');
    expect(agentDisplayNameForSession('demo')).toBe('Mate');
  });
});
