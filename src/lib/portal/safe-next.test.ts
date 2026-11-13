import { describe, it, expect } from "vitest";
import { pathSegment, safeNextPath, safeRelativePath } from "./safe-next";

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

describe("safeNextPath: encoded and nested forms", () => {
  it.each([
    ["an encoded protocol-relative URL", "/%2F%2Fevil.com"],
    ["a mixed-case encoded protocol-relative URL", "/%2f%2Fevil.com"],
    ["an encoded backslash", "/%5Cevil.com"],
    ["a double-encoded protocol-relative URL", "/%252F%252Fevil.com"],
    ["a triple-encoded backslash", "/%25255Cevil.com"],
    ["an encoded tab", "/%09/evil.com"],
    ["an encoded newline", "/x%0A"],
    ["a malformed escape", "/x%E0%A4%A"],
    ["a nested absolute next", "/login?next=https://evil.com"],
    ["a nested encoded absolute next", "/login?next=https%3A%2F%2Fevil.com"],
    ["a nested protocol-relative next", "/login?next=//evil.com"],
    ["a nested backslash next", "/login?next=/%5Cevil.com"],
    ["a nested returnTo", "/x?returnTo=https://evil.com"],
    ["a nested redirect_to", "/x?redirect_to=//evil.com"],
    ["a doubly nested next", "/login?next=%2Flogin%3Fnext%3Dhttps%3A%2F%2Fevil.com"],
    ["an over-long value", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_, value) => {
    expect(safeNextPath(value, ORIGIN)).toBeNull();
  });

  it("keeps a safe nested next and normalizes dot segments", () => {
    expect(safeNextPath("/login?next=%2Fdash%2Fabc", ORIGIN)).toBe("/login?next=%2Fdash%2Fabc");
    expect(safeNextPath("/dash/../codes", ORIGIN)).toBe("/codes");
  });
});

describe("safeRelativePath / pathSegment", () => {
  it("refuses non-strings", () => {
    expect(safeRelativePath(undefined)).toBeNull();
    expect(safeRelativePath(["/x"])).toBeNull();
  });

  it("keeps the hash and the query", () => {
    expect(safeRelativePath("/dash/abc?qb=connected#money")).toBe("/dash/abc?qb=connected#money");
  });

  it("encodes a session id into one segment that cannot add a path, query or fragment", () => {
    const evil = "x/../../login?next=https://evil.com#";
    const path = `/dash/${pathSegment(evil)}?qb=practice`;
    const url = new URL(safeRelativePath(path)!, ORIGIN);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname.startsWith("/dash/")).toBe(true);
    expect([...url.searchParams.keys()]).toEqual(["qb"]);
    expect(pathSegment("..")).toBe("_");
    expect(pathSegment(".")).toBe("_");
    expect(pathSegment("")).toBe("_");
    expect(pathSegment("61400e73-0570-4167-88d9-d3a69650b15b")).toBe("61400e73-0570-4167-88d9-d3a69650b15b");
  });
});
