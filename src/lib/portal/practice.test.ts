import { describe, expect, it } from 'vitest';
import { fakePracticeMessage, practiceCompanyName } from './practice';

describe('practice tenant copy', () => {
  it('puts Practice in the company name exactly once', () => {
    expect(practiceCompanyName('J&C Asphalt Paving', true)).toBe('Practice | J&C Asphalt Paving');
    expect(practiceCompanyName('Practice | J&C Asphalt Paving', true)).toBe('Practice | J&C Asphalt Paving');
    expect(practiceCompanyName('J&C Asphalt Paving', false)).toBe('J&C Asphalt Paving');
    expect(practiceCompanyName(null, false)).toBeNull();
    expect(practiceCompanyName(null, true)).toBe('Practice');
  });

  it('marks outbound practice messages as fake', () => {
    expect(fakePracticeMessage('Thanks for reaching out')).toBe('[Practice fake sent to lead] Thanks for reaching out');
  });
});
