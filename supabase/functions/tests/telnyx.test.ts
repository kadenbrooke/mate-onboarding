import { assertEquals } from "jsr:@std/assert@1"
import { textbackSendAt } from "../_shared/telnyx.ts"

const DELAY_ENV = "DEMO_TEXTBACK_DELAY_SECONDS"

function clearEnv() {
  Deno.env.delete(DELAY_ENV)
}

Deno.test("textbackSendAt: defaults to now + 30s when env unset", () => {
  clearEnv()
  const now = new Date("2026-07-27T12:00:00.000Z")
  assertEquals(textbackSendAt(now), "2026-07-27T12:00:30.000Z")
  clearEnv()
})

Deno.test("textbackSendAt: honours DEMO_TEXTBACK_DELAY_SECONDS", () => {
  clearEnv()
  Deno.env.set(DELAY_ENV, "45")
  const now = new Date("2026-07-27T12:00:00.000Z")
  assertEquals(textbackSendAt(now), "2026-07-27T12:00:45.000Z")
  clearEnv()
})

Deno.test("textbackSendAt: zero/negative/non-numeric => undefined (send immediately)", () => {
  clearEnv()
  const now = new Date("2026-07-27T12:00:00.000Z")
  Deno.env.set(DELAY_ENV, "0")
  assertEquals(textbackSendAt(now), undefined)
  Deno.env.set(DELAY_ENV, "-5")
  assertEquals(textbackSendAt(now), undefined)
  Deno.env.set(DELAY_ENV, "abc")
  assertEquals(textbackSendAt(now), undefined)
  clearEnv()
})

Deno.test("textbackSendAt: empty string => default 30s (treated as unset)", () => {
  clearEnv()
  Deno.env.set(DELAY_ENV, "")
  const now = new Date("2026-07-27T12:00:00.000Z")
  assertEquals(textbackSendAt(now), "2026-07-27T12:00:30.000Z")
  clearEnv()
})
