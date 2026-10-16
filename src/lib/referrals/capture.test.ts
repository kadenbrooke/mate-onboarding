import { describe, expect, it, vi } from 'vitest';
import { captureReferralLead, type ReferralCaptureRepository, type ReferralCode } from './capture';

const referral: ReferralCode = {
  code: 'PARTNER123', session_id: 'tenant-1', referrer_name: 'Sam Partner',
  referrer_email: 'sam@example.com', referrer_phone: '+18015550001',
  expires_at: null,
};

function repo(over: Partial<ReferralCaptureRepository> = {}): ReferralCaptureRepository {
  return {
    findCode: vi.fn(async () => referral),
    findDuplicateLead: vi.fn(async () => null),
    insertLead: vi.fn(async () => ({ id: 'lead-1' })),
    ...over,
  };
}

describe('captureReferralLead', () => {
  it('creates a referral lead with tenant and referrer attribution', async () => {
    const r = repo();
    const result = await captureReferralLead(r, ' partner123 ', {
      name: 'New Customer', phone: '(801) 555-0002', email: 'NEW@EXAMPLE.COM', service: 'Sealcoat',
    });
    expect(result).toMatchObject({ kind: 'created', lead: {
      id: 'lead-1', session_id: 'tenant-1', source: 'referral', referrer_name: 'Sam Partner',
      referral_code: 'PARTNER123', phone: '+18015550002', email: 'new@example.com',
    } });
  });

  it('rejects an invalid code without writing', async () => {
    const r = repo({ findCode: vi.fn(async () => null) });
    await expect(captureReferralLead(r, 'not-a-code!', { name: 'New', phone: '8015550002' }))
      .resolves.toEqual({ kind: 'invalid-code' });
    expect(r.insertLead).not.toHaveBeenCalled();
  });

  it('rejects an expired code without writing', async () => {
    const r = repo({ findCode: vi.fn(async () => ({ ...referral, expires_at: '2020-01-01T00:00:00Z' })) });
    await expect(captureReferralLead(r, referral.code, { name: 'New', phone: '8015550002' }))
      .resolves.toEqual({ kind: 'invalid-code' });
    expect(r.insertLead).not.toHaveBeenCalled();
  });

  it('rejects a duplicate phone/email before inserting', async () => {
    const r = repo({ findDuplicateLead: vi.fn(async () => ({ id: 'existing-lead' })) });
    await expect(captureReferralLead(r, referral.code, { name: 'Repeat', phone: '8015550002' }))
      .resolves.toEqual({ kind: 'duplicate', leadId: 'existing-lead' });
    expect(r.insertLead).not.toHaveBeenCalled();
  });

  it('rejects self-referral by matching referrer email or phone', async () => {
    const r = repo();
    await expect(captureReferralLead(r, referral.code, { name: 'Sam', email: 'SAM@example.com' }))
      .resolves.toEqual({ kind: 'self-referral' });
    await expect(captureReferralLead(r, referral.code, { name: 'Sam', phone: '801-555-0001' }))
      .resolves.toEqual({ kind: 'self-referral' });
    expect(r.insertLead).not.toHaveBeenCalled();
  });

  it('turns a concurrent phone insert into a duplicate result', async () => {
    const findDuplicateLead = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'raced-lead' });
    const r = repo({
      findDuplicateLead,
      insertLead: vi.fn(async () => { throw { code: '23505' }; }),
    });
    await expect(captureReferralLead(r, referral.code, { name: 'Racy', phone: '8015550002' }))
      .resolves.toEqual({ kind: 'duplicate', leadId: 'raced-lead' });
  });
});

