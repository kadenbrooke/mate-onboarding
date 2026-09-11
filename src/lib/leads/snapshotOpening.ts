// The First Responder's first text to a Lead Snapshot lead.
//
// This lead did not contact us. Someone photographed their details off a
// note, so the opener has to say why we are texting before it asks anything,
// or the first message reads as spam from a stranger. Everything after that
// is the FR v4 shape from fr-brain/src/opening.ts: name once, one combined
// ask, opt-out line.
//
// Two copies of this sentence exist on purpose and must stay identical:
//   1. here, so the confirm screen can show exactly what will be sent, and
//   2. the `Build Snapshot Seed + Intro` node in the lead-intake n8n workflow,
//      which is what actually sends it.
// The n8n side is generated from this file by
// scripts/lead-intake/build-workflow.mjs in the amos repo, so the way to change
// the copy is to change it here and regenerate.

export type OpeningTenant = {
  agentName: string;
  businessName: string;
  optOutLine: string;
};

export function firstNameOf(fullName: string | null | undefined): string | null {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/** Lower-cased, underscores to spaces, so a raw enum never reaches a customer. */
export function humanizeService(service: string | null | undefined): string {
  return (service ?? '').replace(/_/g, ' ').trim().toLowerCase();
}

export function snapshotOpening(
  tenant: OpeningTenant,
  lead: { name?: string | null; service?: string | null },
): string {
  const name = firstNameOf(lead.name);
  const service = humanizeService(lead.service);
  const greeting = name ? `Hi ${name}, ` : 'Hi, ';
  const why = service
    ? `You left your info with us about ${service}, so I wanted to reach out. `
    : 'You left your info with us, so I wanted to reach out. ';
  const ask = service
    ? 'Can you tell me a bit about the job and the property address? '
    : 'What work do you need done, and what is the property address? ';
  return `${greeting}this is ${tenant.agentName} with ${tenant.businessName}. ${why}${ask}${tenant.optOutLine}`;
}
