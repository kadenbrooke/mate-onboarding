import type { ReturnSummary } from './revenue';

export type ClientReturnSummary = Omit<ReturnSummary, 'partner'> & { partner: null };

/** Remove the internal 15% basis before a client user's RSC payload is built. */
export function hidePartnerBasis(summary: ReturnSummary): ClientReturnSummary {
  return { ...summary, partner: null };
}
