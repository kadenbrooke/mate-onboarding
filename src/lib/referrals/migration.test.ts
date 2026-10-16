import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0026_referral_capture.sql'),
  'utf8',
);

describe('referral capture migration security', () => {
  it('keeps referral registry and abuse receipts server-only', () => {
    expect(migration).toMatch(/alter table public\.referral_codes enable row level security;/i);
    expect(migration).toMatch(/revoke all on table public\.referral_codes from anon, authenticated;/i);
    expect(migration).toMatch(/alter table public\.referral_capture_attempts enable row level security;/i);
    expect(migration).toMatch(/revoke all on table public\.referral_capture_attempts from anon, authenticated;/i);
  });
});
