import { describe, it, expect } from "vitest"
import { signSession, verifySession, COOKIE_NAME } from "./session-cookie"

const SECRET = "test-secret-please-rotate"

describe("session cookie", () => {
  it("round-trips a session id", () => {
    const token = signSession("abc-123", SECRET)
    expect(verifySession(token, SECRET)).toBe("abc-123")
  })
  it("rejects a tampered id", () => {
    const token = signSession("abc-123", SECRET)
    const tampered = token.replace("abc-123", "abc-124")
    expect(verifySession(tampered, SECRET)).toBeNull()
  })
  it("rejects a wrong secret", () => {
    const token = signSession("abc-123", SECRET)
    expect(verifySession(token, "other")).toBeNull()
  })
  it("rejects malformed tokens without throwing", () => {
    expect(verifySession("", SECRET)).toBeNull()
    expect(verifySession("no-dot-here", SECRET)).toBeNull()
    expect(verifySession(null as unknown as string, SECRET)).toBeNull()
  })
  it("exports a stable cookie name", () => {
    expect(COOKIE_NAME).toBe("mate_session")
  })
})
