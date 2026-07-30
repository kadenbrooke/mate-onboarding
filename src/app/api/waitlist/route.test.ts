import { describe, it, expect, vi, beforeEach } from "vitest";

// Auth client mock (default: a signed-in user). Override per test.
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: "u1", email: "owner@biz.com" } } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

// Service client chains.
// portal_waitlist existing lookup: select().eq().maybeSingle() -> default no row.
const waitlistLookupMaybeSingle = vi.fn(() =>
  Promise.resolve({ data: null as { contact_id: string } | null, error: null })
);
const waitlistLookupEq = vi.fn(() => ({ maybeSingle: waitlistLookupMaybeSingle }));
const waitlistSelect = vi.fn(() => ({ eq: waitlistLookupEq }));
const waitlistUpsert = vi.fn(() => Promise.resolve({ error: null }));

// contacts insert: insert().select().maybeSingle() -> a contact id.
const contactMaybeSingle = vi.fn(() => Promise.resolve({ data: { id: "c1" }, error: null }));
const contactSelect = vi.fn(() => ({ maybeSingle: contactMaybeSingle }));
const contactsInsert = vi.fn(() => ({ select: contactSelect }));

// nudges insert: returns a thenable (route calls .then()).
const nudgesInsert = vi.fn(() => Promise.resolve({ error: null }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "portal_waitlist") return { select: waitlistSelect, upsert: waitlistUpsert };
      if (table === "contacts") return { insert: contactsInsert };
      if (table === "nudges") return { insert: nudgesInsert };
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "owner@biz.com" } } });
    waitlistLookupMaybeSingle.mockResolvedValue({ data: null, error: null });
    contactMaybeSingle.mockResolvedValue({ data: { id: "c1" }, error: null });
    waitlistSelect.mockClear();
    waitlistUpsert.mockClear();
    contactsInsert.mockClear();
    nudgesInsert.mockClear();
  });

  it("401 when no user", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as never);
    const res = await POST(req({ business_name: "Acme" }));
    expect(res.status).toBe(401);
  });

  it("400 when business_name is missing/blank", async () => {
    const res = await POST(req({ business_name: "  " }));
    expect(res.status).toBe(400);
    expect(contactsInsert).not.toHaveBeenCalled();
  });

  it("200 success: inserts contact, upserts waitlist, inserts nudge", async () => {
    const res = await POST(req({ business_name: "Acme", phone: "555", website: "acme.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(contactsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme", company: "Acme", source: "portal-waitlist" })
    );
    expect(waitlistUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", business_name: "Acme", contact_id: "c1" }),
      { onConflict: "user_id" }
    );
    expect(nudgesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ nudge_type: "portal_waitlist", contact_id: "c1" })
    );
  });

  it("reuses the existing contact and skips the contacts insert", async () => {
    waitlistLookupMaybeSingle.mockResolvedValueOnce({ data: { contact_id: "existing" }, error: null });
    const res = await POST(req({ business_name: "Acme" }));
    expect(res.status).toBe(200);
    expect(contactsInsert).not.toHaveBeenCalled();
    expect(waitlistUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: "existing" }),
      { onConflict: "user_id" }
    );
  });
});
