// Per-tenant SMS settings for the Lead Snapshot intake path.
//
// The lead-intake n8n workflow is deliberately dumb and tenant-agnostic: it
// sends whatever number, persona, and business name the payload carries. This
// map is where those come from, keyed by the dash session.
//
// Why a code map and not a table, for now: J&C is the only tenant, and every
// value here already lives hardcoded inside J&C's live n8n workflows (the Meta
// ingest tail and the First Responder). Duplicating them into a table nobody
// else reads yet would be a second source of truth with one row. Phase D, the
// second tenant, is the moment this becomes a table (or a jsonb column on
// client_capabilities), because that is when a code deploy per client stops
// being acceptable.
//
// Copy contract: agentName / businessName / optOutLine must match fr-brain's
// ClientConfig for the same tenant, since the brain owns the thread after the
// first reply and the opener must sound like the same person.

export type IntakeTenant = {
  /** Session this config belongs to. */
  sessionId: string;
  /** contacts.id, stamped onto the conversation row. */
  contactId: string;
  /** Telnyx sending number, E.164. */
  smsFrom: string;
  /** Telnyx messaging profile for 10DLC routing. */
  messagingProfileId: string;
  /** Persona name the First Responder speaks as. */
  agentName: string;
  /** Business name as it appears in the opener. */
  businessName: string;
  /** The opt-out line every first message must carry. */
  optOutLine: string;
  /** Conversation table the brain reads for this tenant, used for dedupe. */
  conversationTable: 'jc_sms_conversations';
};

const JC_SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';

const TENANTS: Record<string, IntakeTenant> = {
  [JC_SESSION]: {
    sessionId: JC_SESSION,
    contactId: '8e4283dc-e8a6-445f-874e-b36328f31f28',
    smsFrom: '+13854409882',
    messagingProfileId: '40019f67-6d6f-455f-8204-414959bd0f72',
    agentName: 'Jeffery',
    businessName: 'J&C Asphalt',
    optOutLine: 'Txt STOP to opt out anytime.',
    conversationTable: 'jc_sms_conversations',
  },
};

/** The intake settings for a session, or null when the tenant is not wired. */
export function intakeTenantFor(sessionId: string): IntakeTenant | null {
  return TENANTS[sessionId] ?? null;
}
