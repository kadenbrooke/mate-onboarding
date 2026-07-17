import { describe, it, expect } from "vitest"
import { isInManifest } from "./capability"

const manifest = [{ capability_key: "first_responder_sms", status: "live" }]

describe("isInManifest", () => {
  it("true for a live capability", () => {
    expect(isInManifest(manifest, "first_responder_sms")).toBe(true)
  })
  it("false for an unknown capability", () => {
    expect(isInManifest(manifest, "voice_agent")).toBe(false)
  })
  it("false when capability exists but is under_construction", () => {
    expect(isInManifest([{ capability_key: "x", status: "under_construction" }], "x")).toBe(false)
  })
  it("false for an empty manifest", () => {
    expect(isInManifest([], "first_responder_sms")).toBe(false)
  })
})
