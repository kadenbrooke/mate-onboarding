import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny scriptable Supabase-query mock. Each test sets the outcomes the
// service client should return per table/op; the mock records the mutations so
// assertions can check what was written and deleted.

type Outcome = { data?: unknown; error?: unknown };

const state: {
  claimUpdateResult: Outcome; // portal_codes .update(...).select().maybeSingle()
  sessionInsertResult: Outcome; // onboarding_sessions .insert().select().single()
  memberInsertResult: Outcome; // portal_members .insert()
  calls: {
    portalCodesUpdates: unknown[];
    sessionInserts: unknown[];
    sessionDeletes: string[];
    memberInserts: unknown[];
  };
} = {
  claimUpdateResult: { data: null, error: null },
  sessionInsertResult: { data: { id: "sess-new" }, error: null },
  memberInsertResult: { error: null },
  calls: { portalCodesUpdates: [], sessionInserts: [], sessionDeletes: [], memberInserts: [] },
};

function reset() {
  state.claimUpdateResult = { data: null, error: null };
  state.sessionInsertResult = { data: { id: "sess-new" }, error: null };
  state.memberInsertResult = { error: null };
  state.calls = { portalCodesUpdates: [], sessionInserts: [], sessionDeletes: [], memberInserts: [] };
}

function makeClient() {
  return {
    from(table: string) {
      if (table === "portal_codes") {
        return {
          update(patch: unknown) {
            state.calls.portalCodesUpdates.push(patch);
            const chain = {
              eq: () => chain,
              is: () => chain,
              gt: () => chain,
              select: () => chain,
              maybeSingle: () => Promise.resolve(state.claimUpdateResult),
              then: (r: (v: Outcome) => unknown) => Promise.resolve({ error: null }).then(r),
            };
            return chain;
          },
        };
      }
      if (table === "onboarding_sessions") {
        return {
          insert(row: unknown) {
            state.calls.sessionInserts.push(row);
            return {
              select: () => ({ single: () => Promise.resolve(state.sessionInsertResult) }),
            };
          },
          delete() {
            return {
              eq(_col: string, id: string) {
                state.calls.sessionDeletes.push(id);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "portal_members") {
        return {
          insert(row: unknown) {
            state.calls.memberInserts.push(row);
            return Promise.resolve(state.memberInsertResult);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => makeClient() }));

import { claimCode, attachMembership } from "./provision";

beforeEach(reset);

describe("claimCode", () => {
  it("returns null when the update yields no row", async () => {
    state.claimUpdateResult = { data: null, error: null };
    expect(await claimCode("MATE-2345-6789")).toBeNull();
  });

  it("returns code + sessionId when a row is claimed", async () => {
    state.claimUpdateResult = { data: { code: "MATE-2345-6789", session_id: "pre-linked" }, error: null };
    expect(await claimCode("MATE-2345-6789")).toEqual({ code: "MATE-2345-6789", sessionId: "pre-linked" });
  });

  it("normalizes a null session_id to null", async () => {
    state.claimUpdateResult = { data: { code: "MATE-2345-6789", session_id: null }, error: null };
    expect(await claimCode("MATE-2345-6789")).toEqual({ code: "MATE-2345-6789", sessionId: null });
  });
});

describe("attachMembership", () => {
  it("uses a pre-linked session (no insert) and inserts the member", async () => {
    const res = await attachMembership({
      code: "MATE-2345-6789",
      userId: "user-1",
      email: "Client@Example.com",
      claimedSessionId: "pre-linked",
    });
    expect(res).toEqual({ sessionId: "pre-linked" });
    expect(state.calls.sessionInserts).toHaveLength(0);
    expect(state.calls.memberInserts[0]).toMatchObject({
      user_id: "user-1",
      email: "client@example.com",
      session_id: "pre-linked",
      role: "owner",
    });
    // claimed_by_email stamped (lowercased) on the code.
    expect(state.calls.portalCodesUpdates[0]).toMatchObject({ claimed_by_email: "client@example.com" });
  });

  it("creates a fresh session then inserts the member", async () => {
    state.sessionInsertResult = { data: { id: "sess-new" }, error: null };
    const res = await attachMembership({
      code: "MATE-2345-6789",
      userId: "user-2",
      email: "b@example.com",
      claimedSessionId: null,
    });
    expect(res).toEqual({ sessionId: "sess-new" });
    expect(state.calls.sessionInserts).toHaveLength(1);
    expect(state.calls.memberInserts[0]).toMatchObject({ session_id: "sess-new" });
  });

  it("returns an error and does not insert a member when session creation fails", async () => {
    state.sessionInsertResult = { data: null, error: { message: "boom" } };
    const res = await attachMembership({
      code: "MATE-2345-6789",
      userId: "user-3",
      email: "c@example.com",
      claimedSessionId: null,
    });
    expect(res).toEqual({ error: "Could not start onboarding." });
    expect(state.calls.memberInserts).toHaveLength(0);
  });

  it("deletes a session it created when the member insert fails", async () => {
    state.sessionInsertResult = { data: { id: "sess-new" }, error: null };
    state.memberInsertResult = { error: { message: "dup" } };
    const res = await attachMembership({
      code: "MATE-2345-6789",
      userId: "user-4",
      email: "d@example.com",
      claimedSessionId: null,
    });
    expect(res).toEqual({ error: "Could not finish account setup." });
    expect(state.calls.sessionDeletes).toEqual(["sess-new"]);
  });

  it("does NOT delete a pre-linked session when the member insert fails", async () => {
    state.memberInsertResult = { error: { message: "dup" } };
    const res = await attachMembership({
      code: "MATE-2345-6789",
      userId: "user-5",
      email: "e@example.com",
      claimedSessionId: "pre-linked",
    });
    expect(res).toEqual({ error: "Could not finish account setup." });
    expect(state.calls.sessionDeletes).toHaveLength(0);
  });
});
