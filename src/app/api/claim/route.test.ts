import { describe, it, expect, vi, beforeEach } from "vitest";

// Auth client mock (default: a signed-in user). Override per test.
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: "u1", email: "owner@biz.com" } } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

// Provision mocks.
const claimCodeMock = vi.fn((..._a: unknown[]) => Promise.resolve<unknown>(null));
const unclaimCodeMock = vi.fn((..._a: unknown[]) => Promise.resolve());
const attachMembershipMock = vi.fn((..._a: unknown[]) => Promise.resolve<unknown>({}));
vi.mock("@/lib/portal/provision", () => ({
  claimCode: (...a: unknown[]) => claimCodeMock(...a),
  unclaimCode: (...a: unknown[]) => unclaimCodeMock(...a),
  attachMembership: (...a: unknown[]) => attachMembershipMock(...a),
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/claim", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "owner@biz.com" } } });
    claimCodeMock.mockReset();
    unclaimCodeMock.mockClear();
    attachMembershipMock.mockReset();
  });

  it("401 when no user", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as never);
    const res = await POST(req({ code: "MATE-AB24-CD56" }));
    expect(res.status).toBe(401);
  });

  it("400 on a code that does not look right", async () => {
    const res = await POST(req({ code: "nope" }));
    expect(res.status).toBe(400);
    expect(claimCodeMock).not.toHaveBeenCalled();
  });

  it("400 when the code cannot be claimed", async () => {
    claimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(req({ code: "MATE-AB24-CD56" }));
    expect(res.status).toBe(400);
  });

  it("500 and unclaims when membership attach fails", async () => {
    claimCodeMock.mockResolvedValueOnce({ code: "MATE-AB24-CD56", sessionId: null });
    attachMembershipMock.mockResolvedValueOnce({ error: "boom" });
    const res = await POST(req({ code: "MATE-AB24-CD56" }));
    expect(res.status).toBe(500);
    expect(unclaimCodeMock).toHaveBeenCalledWith("MATE-AB24-CD56");
  });

  it("200 returns sessionId on success", async () => {
    claimCodeMock.mockResolvedValueOnce({ code: "MATE-AB24-CD56", sessionId: null });
    attachMembershipMock.mockResolvedValueOnce({ sessionId: "sess-9" });
    const res = await POST(req({ code: "MATE-AB24-CD56" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe("sess-9");
  });
});
