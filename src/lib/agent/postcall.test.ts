import { describe, it, expect } from 'vitest';
import { buildMenuText, classifyReply } from './postcall';

describe('buildMenuText', () => {
  it('includes the caller number and all 4 options and the notes line', () => {
    const t = buildMenuText('+18015551234');
    expect(t).toContain('+18015551234');
    expect(t).toContain('1 - Send onboarding form');
    expect(t).toContain('2 - Hand to Mate (agent takes over)');
    expect(t).toContain('3 - Send FAQ');
    expect(t).toContain("4 - Ignore (you've got it handled)");
    expect(t).toContain('Text me any notes from the call and I\'ll log them.');
  });
});

describe('classifyReply', () => {
  it('parses a bare digit as a choice with no notes', () => {
    expect(classifyReply('2')).toEqual({ choice: '2', notes: null });
  });
  it('parses "digit - notes" as choice plus notes', () => {
    expect(classifyReply('2 - wants it before winter, ~$4k')).toEqual({ choice: '2', notes: 'wants it before winter, ~$4k' });
  });
  it('parses freeform text as notes only', () => {
    expect(classifyReply('he wants a quote on 2 driveways')).toEqual({ choice: null, notes: 'he wants a quote on 2 driveways' });
  });
  it('rejects an out-of-range digit as notes', () => {
    expect(classifyReply('9')).toEqual({ choice: null, notes: '9' });
  });
});
