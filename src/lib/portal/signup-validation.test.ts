import { describe, it, expect } from "vitest";
import { validateSignupInput } from "./signup-validation";

describe("validateSignupInput", () => {
  const good = { email: "owner@biz.com", password: "longenough1" };
  it("accepts a valid payload", () => {
    expect(validateSignupInput(good)).toBeNull();
  });
  it("rejects non-object and missing fields", () => {
    expect(validateSignupInput(null)).toBeTruthy();
    expect(validateSignupInput({})).toBeTruthy();
    expect(validateSignupInput({ ...good, email: undefined })).toBeTruthy();
  });
  it("rejects malformed email", () => {
    expect(validateSignupInput({ ...good, email: "not-an-email" })).toBeTruthy();
  });
  it("rejects short password", () => {
    expect(validateSignupInput({ ...good, password: "short" })).toBeTruthy();
  });
});
