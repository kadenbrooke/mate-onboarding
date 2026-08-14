// A lead's NAME cell is blank whenever the row arrived without one -- which is
// the normal state for `source: 'call'` rows, since a missed call gives us a
// number and nothing else until the First Responder extracts a name from the
// reply thread. A blank identity cell is not merely ugly: an empty NAME beside a
// populated CAPTURED column reads as a continuation of the row above, so dates
// get attributed to the wrong lead (founder report, 2026-08-13 -- a July lead
// appeared to be dated Aug 11 because the nameless Aug 11 call rows sat directly
// above it in the default sort).
//
// Every surface that shows a lead's identity goes through `leadLabel` so the
// fallback chain is defined once: name -> formatted phone -> source -> a last
// resort that is still a sentence rather than an empty string.

/** US 10-digit (or 11-digit leading-1) numbers render as `(801) 900-7550`.
 *  Anything else -- short, international, extension-bearing -- is returned
 *  trimmed and unchanged rather than mangled into a false US shape. */
export function formatPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1)
    : digits.length === 10 ? digits
    : null;
  if (!ten) return trimmed;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const SOURCE_LABEL: Record<string, string> = {
  call: 'Caller', missed_call: 'Caller',
  text: 'Texter', texted_in: 'Texter',
  meta: 'Meta lead', google: 'Google lead', web_form: 'Web lead',
  referral: 'Referral', revived: 'Revived lead',
};

export interface LeadIdentity {
  name?: string | null;
  phone?: string | null;
  source?: string | null;
}

/** Non-empty display identity for a lead, plus whether it is the real name.
 *  `named: false` is the signal for callers to style the label as provisional
 *  (muted), so "we have no name yet" stays visually distinct from a real one. */
export function leadIdentity(lead: LeadIdentity): { label: string; named: boolean } {
  const name = lead.name?.trim();
  if (name) return { label: name, named: true };

  const phone = formatPhone(lead.phone);
  if (phone) return { label: phone, named: false };

  const source = lead.source?.trim();
  if (source) return { label: SOURCE_LABEL[source] ?? 'Unnamed lead', named: false };

  return { label: 'Unnamed lead', named: false };
}

/** The label alone -- for aria-labels, confirm prompts, and thread headers,
 *  which need a speakable identity and have no use for the `named` flag. */
export function leadLabel(lead: LeadIdentity): string {
  return leadIdentity(lead).label;
}
