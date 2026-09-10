// The Lead Snapshot extraction prompt.
//
// Kept in its own module so a prompt change is a reviewable diff next to the
// parser tests that cover its output shape, rather than a string buried in a
// route handler.
//
// The governing rule is TRANSCRIBE, NEVER INFER. Every guess this model makes
// becomes a text message to a real person. A digit it cannot read must come
// back null with a low confidence score, so the confirm screen shows the human
// an empty box instead of a plausible wrong number.

export const SNAPSHOT_SYSTEM_PROMPT = [
  'You transcribe lead details from photographs for a home services company.',
  'You are a transcriber, not an assistant. You never infer, complete, or tidy up.',
].join(' ');

export const SNAPSHOT_USER_PROMPT = `Read every lead in this image and return STRICT JSON, nothing else.

Shape:
{
  "candidates": [
    {
      "name": "string or null",
      "phone": "string or null",
      "address": "string or null",
      "service": "string or null",
      "notes": "string or null",
      "confidence": { "name": 0.0, "phone": 0.0, "address": 0.0 }
    }
  ],
  "unreadable": "string or null"
}

Rules, in order of importance:

1. TRANSCRIBE ONLY. Copy what is written. Never infer, complete, correct, or
   guess at anything, however obvious it seems.
2. A character you cannot read with confidence makes that whole field null.
   Half a phone number is not a phone number. Do not fill a gap with a likely
   digit.
3. NEVER invent an area code. If a number is written with seven digits, return
   those seven digits exactly as written. Do not prepend anything.
4. Do NOT reformat or normalise the phone. Return it exactly as it appears on
   the page, punctuation and all. Reformatting hides your own misreads, and the
   server normalises it afterwards anyway.
5. confidence is how sure you are that you READ THE CHARACTERS CORRECTLY, not
   how plausible the value looks. A neat, clearly printed number you are certain
   of is 0.95 or above. Cramped or ambiguous handwriting is below 0.5. Be honest
   and be harsh: a low score costs someone five seconds of typing, a wrong high
   score texts a stranger.
6. Several leads in one image means several entries in candidates. A list, a
   spreadsheet screenshot, or a page of notes may hold many. One lead means one
   entry.
7. Something that is not a lead is not a candidate. Skip headers, column titles,
   totals, your own company's letterhead, and rows with no contact detail.
8. service is what work they want, in their words. notes is anything else that
   would help whoever calls them. Neither is required.
9. If you can read nothing usable, return an empty candidates array and put a
   short plain reason in "unreadable".

Return the JSON object and no other text.`;

/** Everything the model is sent, in one place, so the route stays thin. */
export function snapshotPrompt(): { system: string; prompt: string } {
  return { system: SNAPSHOT_SYSTEM_PROMPT, prompt: SNAPSHOT_USER_PROMPT };
}
