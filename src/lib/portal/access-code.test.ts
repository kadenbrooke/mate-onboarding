import { describe, it, expect } from "vitest";
import { generateAccessCode, normalizeCode, codeState, CODE_ALPHABET } from "./access-code";

describe("generateAccessCode", () => {
  it("produces MATE-XXXX-XXXX from the safe alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAccessCode();
      expect(code).toMatch(/^MATE-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    }
  });
  it("alphabet excludes ambiguous chars", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) expect(CODE_ALPHABET).not.toContain(ch);
  });
});

describe("normalizeCode", () => {
  it("canonicalizes case, whitespace, and missing dashes", () => {
    expect(normalizeCode(" mate-ab24-cd56 ")).toBe("MATE-AB24-CD56");
    expect(normalizeCode("MATEAB24CD56")).toBe("MATE-AB24-CD56");
    expect(normalizeCode("ab24 cd56")).toBe("MATE-AB24-CD56");
  });
  it("rejects wrong shapes", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("MATE-AB24")).toBeNull();
    expect(normalizeCode("MATE-AB24-CD5!")).toBeNull();
  });
});

describe("codeState", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const base = { claimed_at: null as string | null, expires_at: "2026-08-28T00:00:00Z" };
  it("valid when unclaimed and unexpired", () => {
    expect(codeState(base, now)).toBe("valid");
  });
  it("claimed wins over expired", () => {
    expect(codeState({ claimed_at: "2026-07-20T00:00:00Z", expires_at: "2026-07-01T00:00:00Z" }, now)).toBe("claimed");
  });
  it("expired when past expires_at", () => {
    expect(codeState({ ...base, expires_at: "2026-07-27T00:00:00Z" }, now)).toBe("expired");
  });
});
