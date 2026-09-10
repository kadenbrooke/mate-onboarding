// Parse the vision model's reply into confirm-screen candidates.
//
// Pure, no network. This is the regression surface for any prompt or model
// change: if a swap breaks extraction, it breaks here first, in a unit test,
// not in a text to a stranger.
//
// Why hand-rolled parsing and not a structured-output schema: vision plus
// response-schema is a known break in this stack (amos memory
// feedback_generateobject_vision_schema). We ask for JSON in the prompt and
// parse it here, tolerating the ways a model wraps JSON in prose.

/** Fields that carry a confidence score and can therefore be withheld. */
export const SCORED_FIELDS = ['name', 'phone', 'address'] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

/**
 * Below this, the field is withheld rather than prefilled.
 *
 * The confirm screen shows an empty highlighted box instead of the model's
 * guess. A blank the human fills beats a wrong value the human skims past,
 * and on `phone` a single wrong digit texts a stranger.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

export type SnapshotCandidate = {
  name: string | null;
  phone: string | null;
  address: string | null;
  service: string | null;
  notes: string | null;
  confidence: Record<ScoredField, number>;
  /** Scored fields the model read, but not well enough to prefill. */
  withheld: ScoredField[];
};

export type ParseResult =
  | { ok: true; candidates: SnapshotCandidate[]; unreadable: string | null }
  | { ok: false; reason: 'no-json' | 'bad-shape' };

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  // Models like to fill a blank with a placeholder rather than emit null.
  // Treat the common ones as absent, so they never reach the confirm screen
  // looking like something the model actually read.
  const lowered = t.toLowerCase();
  if (['null', 'n/a', 'na', 'none', 'unknown', 'unreadable', '-', '--'].includes(lowered)) {
    return null;
  }
  return t;
}

function cleanScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Pull the first balanced JSON object out of a model reply.
 *
 * Handles a bare object, a ```json fenced block, and an object with prose
 * either side of it. Brace counting rather than a regex, because a nested
 * object in `confidence` defeats a lazy match and an address containing a
 * brace defeats a greedy one. String-aware so a brace inside a quoted value
 * does not throw off the depth count.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Normalise one raw candidate object, withholding anything under threshold. */
function toCandidate(raw: Record<string, unknown>): SnapshotCandidate {
  const confidence = (raw.confidence ?? {}) as Record<string, unknown>;
  const scores: Record<ScoredField, number> = {
    name: cleanScore(confidence.name),
    phone: cleanScore(confidence.phone),
    address: cleanScore(confidence.address),
  };

  const withheld: ScoredField[] = [];
  const values: Record<ScoredField, string | null> = {
    name: cleanString(raw.name),
    phone: cleanString(raw.phone),
    address: cleanString(raw.address),
  };

  for (const field of SCORED_FIELDS) {
    if (values[field] !== null && scores[field] < CONFIDENCE_THRESHOLD) {
      withheld.push(field);
      values[field] = null;
    }
  }

  return {
    name: values.name,
    phone: values.phone,
    address: values.address,
    service: cleanString(raw.service),
    notes: cleanString(raw.notes),
    confidence: scores,
    withheld,
  };
}

/** True when a candidate carries nothing a human could act on. */
function isEmptyCandidate(c: SnapshotCandidate): boolean {
  return !c.name && !c.phone && !c.address && !c.service && !c.notes && c.withheld.length === 0;
}

/**
 * Parse a model reply into candidates.
 *
 * Never throws. A reply we cannot read returns ok:false and the caller marks
 * the snapshot `failed`, which the client sees as "could not read that photo",
 * not as a crash.
 */
export function parseSnapshotReply(reply: string | null | undefined): ParseResult {
  const text = (reply ?? '').trim();
  if (!text) return { ok: false, reason: 'no-json' };

  const json = extractJsonObject(text);
  if (!json) return { ok: false, reason: 'no-json' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'no-json' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'bad-shape' };
  }

  const obj = parsed as Record<string, unknown>;
  const unreadable = cleanString(obj.unreadable);

  if (!Array.isArray(obj.candidates)) {
    // A model that found nothing sometimes reports it via `unreadable` alone
    // and omits the array entirely. That is a successful read of an unusable
    // photo, not a parse failure.
    if (unreadable) return { ok: true, candidates: [], unreadable };
    return { ok: false, reason: 'bad-shape' };
  }

  const candidates = obj.candidates
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c))
    .map(toCandidate)
    .filter(c => !isEmptyCandidate(c));

  return { ok: true, candidates, unreadable };
}
