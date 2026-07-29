import { describe, it, expect } from "vitest";
import { resolveDashAccess } from "./dash-access";

describe("resolveDashAccess", () => {
  it("404 when session missing regardless of auth", () => {
    expect(resolveDashAccess({ sessionExists: false, isDemo: false, hasUser: true, isMember: true, isInternal: true }))
      .toBe("not-found");
  });
  it("demo sessions are public", () => {
    expect(resolveDashAccess({ sessionExists: true, isDemo: true, hasUser: false, isMember: false, isInternal: false }))
      .toBe("demo");
  });
  it("no user on a real session goes to login", () => {
    expect(resolveDashAccess({ sessionExists: true, isDemo: false, hasUser: false, isMember: false, isInternal: false }))
      .toBe("login");
  });
  it("member allowed", () => {
    expect(resolveDashAccess({ sessionExists: true, isDemo: false, hasUser: true, isMember: true, isInternal: false }))
      .toBe("member");
  });
  it("internal staff allowed on any session", () => {
    expect(resolveDashAccess({ sessionExists: true, isDemo: false, hasUser: true, isMember: false, isInternal: true }))
      .toBe("internal");
  });
  it("authed stranger is forbidden", () => {
    expect(resolveDashAccess({ sessionExists: true, isDemo: false, hasUser: true, isMember: false, isInternal: false }))
      .toBe("forbidden");
  });
});
