import { describe, it, expect } from "vitest";
import { safeNextPath } from "./safe-next";

const ORIGIN = "https://mate.auto-mate.business";

describe("safeNextPath", () => {
  it("accepts a plain same-origin path", () => {
    expect(safeNextPath("/dash/abc", ORIGIN)).toBe("/dash/abc");
  });

  it("accepts a same-origin path with a query string", () => {
    expect(safeNextPath("/onboard?session=x", ORIGIN)).toBe("/onboard?session=x");
  });

  it("rejects null", () => {
    expect(safeNextPath(null, ORIGIN)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(safeNextPath("", ORIGIN)).toBeNull();
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.com/x", ORIGIN)).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNextPath("//evil.com", ORIGIN)).toBeNull();
  });

  it("rejects a backslash protocol-relative trick", () => {
    // "/\evil.com" (single backslash). URL parsing normalizes the backslash to
    // a forward slash, making it protocol-relative to evil.com; the origin
    // check must catch it.
    const tricky = "/\\evil.com";
    expect(new URL(tricky, ORIGIN).origin).toBe("https://evil.com");
    expect(safeNextPath(tricky, ORIGIN)).toBeNull();
  });

  it("rejects a whitespace-normalization trick", () => {
    // Literal tab inside the value. URL parsing strips tabs/newlines, which can
    // turn a "path" into a cross-origin navigation under string matching.
    expect(safeNextPath("/\t/evil.com", ORIGIN)).toBeNull();
  });

  it("rejects a javascript: URL", () => {
    expect(safeNextPath("javascript:alert(1)", ORIGIN)).toBeNull();
  });
});
