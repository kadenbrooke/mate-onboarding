export type PostcallChoice = '1' | '2' | '3' | '4';

export function buildMenuText(callerNumber: string): string {
  return [
    `Call w/ ${callerNumber} done. What next? Reply:`,
    '1 - Send onboarding form',
    '2 - Hand to Mate (agent takes over)',
    '3 - Send FAQ',
    "4 - Ignore (you've got it handled)",
    '',
    "Text me any notes from the call and I'll log them.",
  ].join('\n');
}

/**
 * Classify an operator reply. A leading 1-4 (optionally followed by punctuation
 * then notes) is a choice; anything else is freeform notes. An out-of-range
 * leading digit is treated as notes, not a choice.
 */
export function classifyReply(raw: string): { choice: PostcallChoice | null; notes: string | null } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^([1-9])\b[\s.):-]*([\s\S]*)$/);
  if (m && ['1', '2', '3', '4'].includes(m[1])) {
    const notes = m[2].trim();
    return { choice: m[1] as PostcallChoice, notes: notes.length ? notes : null };
  }
  return { choice: null, notes: trimmed.length ? trimmed : null };
}
