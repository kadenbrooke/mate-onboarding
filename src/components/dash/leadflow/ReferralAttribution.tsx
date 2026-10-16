import { UsersThree } from '@phosphor-icons/react';
import type { Lead } from '@/lib/metrics/leads';
import { Card } from '../Card';

export function ReferralAttribution({ leads }: { leads: Lead[] }) {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    if (lead.source !== 'referral') continue;
    const name = lead.referrer_name?.trim() || 'Unattributed referral';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const referrers = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = referrers.reduce((sum, [, count]) => sum + count, 0);

  return (
    <Card label="REFERRAL ATTRIBUTION">
      <div data-testid="referral-attribution" style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UsersThree size={20} weight="fill" color="var(--brand-primary, #e14d1a)" aria-hidden />
          <strong>{total} {total === 1 ? 'referred lead' : 'referred leads'}</strong>
        </div>
        {referrers.length > 0 ? referrers.map(([name, count]) => (
          <div key={name} data-testid="referral-attribution-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span>{name}</span><strong>{count}</strong>
          </div>
        )) : <span style={{ color: '#888', fontSize: 13 }}>No referral leads yet.</span>}
      </div>
    </Card>
  );
}

