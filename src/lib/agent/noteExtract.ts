import type { SupabaseClient } from '@supabase/supabase-js';
import { chatComplete } from '@/lib/demo/portkey';

// Operator call notes are freeform SMS ("talked to Dave, 1450 e center st in
// Lehi, wants the driveway sealed, quoted him 2200"). This pulls the structured
// bits out of that sentence and drops them into the lead's EMPTY fields, so the
// pipeline table fills itself instead of asking the operator to type twice.
//
// Best-effort by contract: every failure path (model down, junk JSON, DB error)
// returns quietly. The operator's reply flow must never break because an
// extraction did not work, and the note itself is already logged verbatim to
// lead_messages before this runs.

export type NoteFields = {
  name?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  service?: string | null;
  quote_cents?: number | null;
};

const SYSTEM = [
  'You extract contact and job details from a contractor\'s freeform note about a phone call.',
  'Return ONLY a JSON object, no prose and no code fence, with these keys:',
  '{"name":string|null,"email":string|null,"address":string|null,"city":string|null,"service":string|null,"quote_dollars":number|null}',
  'Use null for anything the note does not clearly state. Never guess or infer a value that is not written.',
  'name = the customer\'s name. address = street address only, without the city.',
  'service = the job in two or three words (for example "driveway sealcoat", "parking lot").',
  'quote_dollars = the price quoted, as a plain number of dollars.',
].join('\n');

/** Strip a ```json fence if the model added one, then parse. Returns null on
 *  anything that is not a JSON object. */
export function parseNoteJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.toLowerCase() !== 'null' ? t : null;
};

/** Coerce the model's loose JSON into typed lead fields. Pure, unit tested. */
export function toNoteFields(parsed: Record<string, unknown> | null): NoteFields {
  if (!parsed) return {};
  const dollars = parsed.quote_dollars;
  const numeric = typeof dollars === 'number'
    ? dollars
    : typeof dollars === 'string' ? Number(dollars.replace(/[^0-9.]/g, '')) : NaN;
  return {
    name: str(parsed.name),
    email: str(parsed.email),
    address: str(parsed.address),
    city: str(parsed.city),
    service: str(parsed.service),
    quote_cents: Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) : null,
  };
}

/** Only the fields that are non-null here AND empty on the lead. An operator's
 *  earlier correction always beats a later extraction. */
export function fillableFields(
  extracted: NoteFields,
  current: Record<string, unknown>,
): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  for (const key of ['name', 'email', 'address', 'city', 'service', 'quote_cents'] as const) {
    const value = extracted[key];
    if (value == null) continue;
    if (current[key] != null && current[key] !== '') continue;
    patch[key] = value;
  }
  return patch;
}

/** Ask the model for the fields in a note. Returns {} on any failure. */
export async function extractNoteFields(note: string): Promise<NoteFields> {
  if (!note.trim()) return {};
  const raw = await chatComplete({
    taskClass: 'extract',
    system: SYSTEM,
    messages: [{ role: 'user', content: note.trim().slice(0, 2000) }],
  });
  return toNoteFields(parseNoteJson(raw));
}

/**
 * Extract a note's fields and write the ones the lead is missing.
 * Never throws: callers run this inside the operator reply path.
 */
export async function applyNoteToLead(
  supabase: SupabaseClient,
  args: { leadId: string; sessionId: string; note: string },
): Promise<{ patched: string[] }> {
  try {
    const extracted = await extractNoteFields(args.note);
    if (Object.values(extracted).every(v => v == null)) return { patched: [] };

    const { data: current } = await supabase
      .from('client_leads')
      .select('name, email, address, city, service, quote_cents')
      .eq('id', args.leadId)
      .eq('session_id', args.sessionId)
      .maybeSingle();
    if (!current) return { patched: [] };

    const patch = fillableFields(extracted, current as Record<string, unknown>);
    if (Object.keys(patch).length === 0) return { patched: [] };

    await supabase.from('client_leads').update(patch)
      .eq('id', args.leadId).eq('session_id', args.sessionId);
    return { patched: Object.keys(patch) };
  } catch {
    return { patched: [] };
  }
}
