/**
 * Pure logic: map a finished onboarding session's `collected` blob (plus the
 * session row) to the First Responder build brief Kaden works off to stand up
 * the client's missed-call text-back + SMS lead qualifier (Phase 1 = manual
 * n8n / Telnyx build).
 *
 * Side-effect free and DB-free so it is unit-testable and the server component
 * stays thin. It NEVER fabricates a value: a missing optional field renders as
 * the NOT_PROVIDED sentinel, never an invented default.
 *
 * The First Responder field set mirrors
 * departments/customer-success/clients/jc-asphalt-paving/first-responder-spec.md:
 *   Business:      legal name, DBA, address, EIN
 *   Contact:       primary contact name / phone / email (+ secondary if given)
 *   Phone/Forward: current line (forward source), forward confirmed,
 *                  lead-delivery number (where warm leads are texted),
 *                  published channels (where the number appears)
 *   Services:      services offered, rough pricing
 *   Voice/Qualify: brand voice, qualify criteria, notes
 *   Integrations:  Google connected (yes/no)
 */

// Sentinel shown for any optional field the onboarding did not capture. Kept as
// a single constant so the UI, the copy block, and the tests all agree.
export const NOT_PROVIDED = "(not provided)";

export interface BriefField {
  label: string;
  value: string;
}

export interface BriefGroup {
  title: string;
  fields: BriefField[];
}

export interface Brief {
  /** Best-effort human title for the page header (business name / mate name). */
  heading: string;
  /** Field groups for the structured on-page render. */
  groups: BriefGroup[];
  /** Plain-text copy-ready block Kaden pastes to start the build. */
  copyText: string;
}

// Minimal shape of the session row the brief needs. Widened to `unknown` on the
// dynamic bits because `collected` is free-form JSONB.
export interface HandoffSession {
  id?: string | null;
  mate_name?: string | null;
  website_url?: string | null;
  status?: string | null;
  collected?: unknown;
}

// Human labels for the `published` channel values written by PhoneForwardCard.
// Kept in sync with that card's CHANNELS list; an unknown value falls back to
// the raw token so nothing is silently dropped.
const CHANNEL_LABELS: Record<string, string> = {
  websites: "Website(s)",
  ads: "Paid ads",
  gbp: "Google Business",
  cards: "Business cards",
  signage: "Vehicle / signage",
};

// Human labels for the `lead_channels` values written by ChannelsCard. Kept in
// sync with that card's LEAD_CHANNELS list; unknown tokens fall back raw.
const LEAD_CHANNEL_LABELS: Record<string, string> = {
  missed_calls: "Missed phone calls",
  web_form: "Website form",
  fb_ig_dm: "Facebook / Instagram DMs",
  google_business: "Google Business",
  phone_answered: "Calls answered live",
  other: "Other",
};

/** Trim to a non-empty string, else null. Never coerces non-strings. */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** A value for display: the string if present, else the NOT_PROVIDED sentinel. */
function show(v: unknown): string {
  return str(v) ?? NOT_PROVIDED;
}

/** Render a boolean-ish flag as Yes / No, or NOT_PROVIDED when unset. */
function showBool(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return NOT_PROVIDED;
}

/** Comma-join a string[] for display; NOT_PROVIDED when empty / not an array. */
function showList(v: unknown): string {
  if (!Array.isArray(v)) return NOT_PROVIDED;
  const items = v.map(str).filter((s): s is string => s !== null);
  return items.length ? items.join(", ") : NOT_PROVIDED;
}

/** Map published channel tokens to their human labels, joined. */
function showChannels(v: unknown): string {
  if (!Array.isArray(v)) return NOT_PROVIDED;
  const labels = v
    .map(str)
    .filter((s): s is string => s !== null)
    .map((token) => CHANNEL_LABELS[token] ?? token);
  return labels.length ? labels.join(", ") : NOT_PROVIDED;
}

/** Map lead_channels tokens (from ChannelsCard) to human labels, joined. */
function showLeadChannels(v: unknown): string {
  if (!Array.isArray(v)) return NOT_PROVIDED;
  const labels = v
    .map(str)
    .filter((s): s is string => s !== null)
    .map((token) => LEAD_CHANNEL_LABELS[token] ?? token);
  return labels.length ? labels.join(", ") : NOT_PROVIDED;
}

/**
 * Build the First Responder brief from a session row. `collected` is treated as
 * an opaque object; anything missing renders as NOT_PROVIDED. Never throws on a
 * malformed blob — a non-object `collected` degrades to an all-missing brief.
 */
export function buildBrief(session: HandoffSession): Brief {
  const collected: Record<string, unknown> =
    session.collected && typeof session.collected === "object" && !Array.isArray(session.collected)
      ? (session.collected as Record<string, unknown>)
      : {};

  // Research pre-fill nests the company under `collected.company`.
  const company: Record<string, unknown> =
    collected.company && typeof collected.company === "object" && !Array.isArray(collected.company)
      ? (collected.company as Record<string, unknown>)
      : {};

  // Prefer an explicitly-collected legal name; the company research name is a
  // reasonable display fallback for the heading only (not for the legal field).
  const companyName = str(company.name);
  const legalName = str(collected.legal_business_name);
  const heading =
    companyName ?? legalName ?? str(session.mate_name) ?? "Handoff brief";

  const groups: BriefGroup[] = [
    {
      title: "Business",
      fields: [
        { label: "Legal business name", value: show(collected.legal_business_name) },
        { label: "DBA", value: show(collected.dba) },
        { label: "Business address", value: show(collected.business_address) },
        { label: "EIN", value: show(collected.ein) },
      ],
    },
    {
      title: "10DLC registration",
      fields: [
        { label: "Legal business name", value: show(collected.legal_business_name) },
        { label: "EIN", value: show(collected.ein) },
        { label: "Business address", value: show(collected.business_address) },
        { label: "Entity type", value: show(collected.entity_type) },
        { label: "Website editor", value: show(collected.website_editor_name) },
        { label: "Website editor contact", value: show(collected.website_editor_contact) },
        { label: "Client can edit site", value: show(collected.website_can_edit) },
      ],
    },
    {
      title: "Lead channels & baseline",
      fields: [
        { label: "Lead channels", value: showLeadChannels(collected.lead_channels) },
        { label: "Leads per week", value: show(collected.leads_per_week) },
        { label: "Average job value", value: show(collected.avg_job_value) },
      ],
    },
    {
      title: "Contact",
      fields: [
        { label: "Primary contact", value: show(collected.contact_name) },
        { label: "Contact email", value: show(collected.contact_email) },
        { label: "Secondary contact", value: show(collected.second_contact) },
      ],
    },
    {
      title: "Phone & forwarding",
      fields: [
        { label: "Current line (forward source)", value: show(collected.current_phone) },
        { label: "Forwarding confirmed", value: showBool(collected.forward_confirmed) },
        { label: "Lead delivery number", value: show(collected.lead_delivery_phone) },
        { label: "Published on", value: showChannels(collected.published) },
      ],
    },
    {
      title: "Services",
      fields: [
        { label: "Services offered", value: showList(collected.services) },
        { label: "Rough pricing", value: show(collected.services_pricing) },
      ],
    },
    {
      title: "Voice & qualify",
      fields: [
        { label: "Brand voice", value: show(collected.brand_voice) },
        { label: "Qualify criteria", value: show(collected.qualify_criteria) },
        { label: "Notes", value: show(collected.notes) },
      ],
    },
    {
      title: "Integrations",
      fields: [
        { label: "Google connected", value: showBool(collected.google_connected) },
        { label: "Website", value: show(session.website_url) },
      ],
    },
  ];

  const copyText = buildCopyText(heading, session, groups);

  return { heading, groups, copyText };
}

/**
 * Compose the plain-text, copy-ready brief. Mirrors the on-page groups so what
 * Kaden copies matches what he sees. No em dashes (brand rule); simple sections
 * a build ticket can consume verbatim.
 */
function buildCopyText(
  heading: string,
  session: HandoffSession,
  groups: BriefGroup[]
): string {
  const lines: string[] = [];
  lines.push(`FIRST RESPONDER BUILD BRIEF: ${heading}`);
  if (session.id) lines.push(`Session: ${session.id}`);
  if (session.status) lines.push(`Onboarding status: ${session.status}`);
  lines.push("");

  for (const group of groups) {
    lines.push(`## ${group.title}`);
    for (const field of group.fields) {
      lines.push(`- ${field.label}: ${field.value}`);
    }
    lines.push("");
  }

  // Trim the trailing blank line for a clean paste.
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}
