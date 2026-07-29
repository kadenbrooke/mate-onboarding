import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signPendingCode, verifyPendingCode, PENDING_CODE_COOKIE } from "./pending-code";

const SECRET = "test-secret-please-rotate";
const CODE = "MATE-2345-6789";

describe("pending-code cookie", () => {
  const original = process.env.MATE_SESSION_SECRET;
  beforeEach(() => {
    process.env.MATE_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MATE_SESSION_SECRET;
    else process.env.MATE_SESSION_SECRET = original;
  });

  it("round-trips a code", () => {
    const token = signPendingCode(CODE);
    expect(verifyPendingCode(token)).toBe(CODE);
  });

  it("rejects a tampered code", () => {
    const token = signPendingCode(CODE);
    const tampered = token.replace("2345", "9999");
    expect(verifyPendingCode(tampered)).toBeNull();
  });

  it("rejects garbage and undefined without throwing", () => {
    expect(verifyPendingCode(undefined)).toBeNull();
    expect(verifyPendingCode("")).toBeNull();
    expect(verifyPendingCode("no-dot-here")).toBeNull();
    expect(verifyPendingCode(".onlysig")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signPendingCode(CODE);
    process.env.MATE_SESSION_SECRET = "some-other-secret";
    expect(verifyPendingCode(token)).toBeNull();
  });

  it("exports a stable cookie name", () => {
    expect(PENDING_CODE_COOKIE).toBe("mate_pending_code");
  });
});
