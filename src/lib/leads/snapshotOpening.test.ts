import { describe, it, expect } from 'vitest';
import { snapshotOpening, firstNameOf, humanizeService } from './snapshotOpening';
import { intakeTenantFor } from './intakeTenants';

const jc = intakeTenantFor('61400e73-0570-4167-88d9-d3a69650b15b')!;

describe('snapshotOpening', () => {
  it('says why we are texting before it asks anything', () => {
    const text = snapshotOpening(jc, { name: 'Rynell Davis', service: 'driveway' });
    expect(text).toBe(
      'Hi Rynell, this is Jeffery with J&C Asphalt. You left your info with us about driveway, so I wanted to reach out. ' +
      'Can you tell me a bit about the job and the property address? Txt STOP to opt out anytime.',
    );
  });

  it('falls back to the cold ask with no service', () => {
    const text = snapshotOpening(jc, { name: null, service: null });
    expect(text).toBe(
      'Hi, this is Jeffery with J&C Asphalt. You left your info with us, so I wanted to reach out. ' +
      'What work do you need done, and what is the property address? Txt STOP to opt out anytime.',
    );
  });

  it('never lets a raw enum reach the customer', () => {
    expect(snapshotOpening(jc, { service: 'damaged_driveway' })).toContain('about damaged driveway,');
  });

  it('always carries the opt-out line', () => {
    for (const lead of [{}, { name: 'A' }, { service: 's' }, { name: 'A', service: 's' }]) {
      expect(snapshotOpening(jc, lead)).toMatch(/Txt STOP to opt out anytime\.$/);
    }
  });

  it('uses the first name only, once', () => {
    const text = snapshotOpening(jc, { name: '  Sam Carson ' });
    expect(text.startsWith('Hi Sam, ')).toBe(true);
    expect(text.match(/Sam/g)).toHaveLength(1);
  });

  it('contains no em dashes', () => {
    expect(snapshotOpening(jc, { name: 'A', service: 'b' })).not.toContain('—');
  });
});

describe('helpers', () => {
  it('firstNameOf', () => {
    expect(firstNameOf('Rynell Davis')).toBe('Rynell');
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
  it('humanizeService', () => {
    expect(humanizeService('Damaged_Driveway')).toBe('damaged driveway');
    expect(humanizeService(null)).toBe('');
  });
});

describe('intakeTenantFor', () => {
  it('knows J&C and nobody else', () => {
    expect(jc.smsFrom).toBe('+13854409882');
    expect(intakeTenantFor('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
