import type { ReturnSummary, SourceReturn } from './revenue';

export type ClientSourceReturn = Omit<SourceReturn, 'owner' | 'partner_collected_in_window_cents'> & {
  owner?: never;
  partner_collected_in_window_cents?: never;
};
export type ClientReturnSummary = Omit<ReturnSummary, 'partner' | 'rows'> & {
  partner: null;
  rows: ClientSourceReturn[];
};

/** Remove all partner-basis metadata before a client user's RSC payload is built. */
export function hidePartnerBasis(summary: ReturnSummary): ClientReturnSummary {
  const rows = summary.rows.map(row => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'owner' && key !== 'partner_collected_in_window_cents'),
  ) as unknown as ClientSourceReturn);
  return { ...summary, rows, partner: null };
}
