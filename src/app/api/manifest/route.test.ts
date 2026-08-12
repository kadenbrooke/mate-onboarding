import { describe, it, expect, vi, beforeEach } from 'vitest';

// The route makes up to two reads:
//   1. onboarding_sessions.select('collected, contact_id').eq('id',id).maybeSingle()
//   2. contacts.select('company').eq('id', contact_id).maybeSingle()  [only if 1 has no name]
const sessionMaybeSingle = vi.fn();
const sessionEq = vi.fn(() => ({ maybeSingle: sessionMaybeSingle }));
const sessionSelect = vi.fn(() => ({ eq: sessionEq }));

const contactMaybeSingle = vi.fn();
const contactEq = vi.fn(() => ({ maybeSingle: contactMaybeSingle }));
const contactSelect = vi.fn(() => ({ eq: contactEq }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === 'contacts' ? { select: contactSelect } : { select: sessionSelect },
  }),
}));

const { GET } = await import('./route');

const SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';
const DEMO_UUID = 'b7573135-d4ec-43bb-bf33-a1d365739784';
const CONTACT = '8e4283dc-e8a6-445f-874e-b36328f31f28';

function call(qs: string) {
  return GET(new Request(`https://mate.auto-mate.business/api/manifest${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMaybeSingle.mockResolvedValue({
    data: { collected: { company: { name: 'J&C Asphalt Paving' } }, contact_id: CONTACT },
    error: null,
  });
  contactMaybeSingle.mockResolvedValue({ data: { company: 'Contacts Co' }, error: null });
});

describe('GET /api/manifest', () => {
  it('scopes start_url, scope, and id to the session', async () => {
    const res = await call(`?session=${SESSION}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.start_url).toBe(`/dash/${SESSION}`);
    expect(body.scope).toBe(`/dash/${SESSION}`);
    expect(body.id).toBe(`/dash/${SESSION}`);
    // The whole point of the fix: never the old static /onboard landing.
    expect(body.start_url).not.toBe('/onboard');
  });

  it('names the installed app from collected.company.name when present', async () => {
    const body = await (await call(`?session=${SESSION}`)).json();
    expect(body.name).toBe('J&C Asphalt Paving');
    // Sliced to 12 then trimmed, so no trailing space in the home-screen label.
    expect(body.short_name).toBe('J&C Asphalt');
    expect(contactSelect).not.toHaveBeenCalled();
  });

  it('falls back to contacts.company for a founder-provisioned session', async () => {
    // J&C's real shape: collected is empty, contact_id carries the business.
    sessionMaybeSingle.mockResolvedValue({
      data: { collected: {}, contact_id: CONTACT },
      error: null,
    });
    const body = await (await call(`?session=${SESSION}`)).json();
    expect(contactEq).toHaveBeenCalledWith('id', CONTACT);
    expect(body.name).toBe('Contacts Co');
  });

  it('falls back to "Mate" when neither source has a name', async () => {
    sessionMaybeSingle.mockResolvedValue({ data: { collected: {}, contact_id: null }, error: null });
    const body = await (await call(`?session=${SESSION}`)).json();
    expect(body.name).toBe('Mate');
    expect(body.short_name).toBe('Mate');
    expect(body.start_url).toBe(`/dash/${SESSION}`);
    expect(contactSelect).not.toHaveBeenCalled();
  });

  it('still serves a manifest when the DB read throws', async () => {
    sessionMaybeSingle.mockRejectedValue(new Error('down'));
    const res = await call(`?session=${SESSION}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Mate');
    expect(body.start_url).toBe(`/dash/${SESSION}`);
  });

  it('keeps the "demo" alias in the paths and leaves the demo install generic', async () => {
    const body = await (await call('?session=demo')).json();
    expect(body.start_url).toBe('/dash/demo');
    expect(body.scope).toBe('/dash/demo');
    // Public prospect-facing demo carries no Auto Mate / client branding.
    expect(body.name).toBe('Mate');
    expect(sessionSelect).not.toHaveBeenCalled();
  });

  it('leaves the demo generic when addressed by its raw UUID too', async () => {
    const body = await (await call(`?session=${DEMO_UUID}`)).json();
    expect(body.name).toBe('Mate');
    expect(body.start_url).toBe(`/dash/${DEMO_UUID}`);
    expect(sessionSelect).not.toHaveBeenCalled();
  });

  it.each(['', '?session=', '?session=/onboard', '?session=../../evil', '?session=not-a-uuid'])(
    'rejects %s so an install cannot be pointed at an arbitrary path',
    async (qs) => {
      const res = await call(qs);
      expect(res.status).toBe(400);
      expect(sessionSelect).not.toHaveBeenCalled();
    }
  );

  it('serves the manifest content type', async () => {
    const res = await call(`?session=${SESSION}`);
    expect(res.headers.get('content-type')).toContain('application/manifest+json');
  });
});
