import { assertEquals } from "jsr:@std/assert@1"
import { verifyTelnyx, isProd } from "../_shared/verify.ts"

// Ensure a clean prod-detection baseline for each test (concurrent-safe within file).
function clearProdEnv() {
  Deno.env.delete("DENO_DEPLOYMENT_ID")
  Deno.env.delete("DEMO_ENV")
}

Deno.test("verifyTelnyx: dev-skips when no public key AND not in prod", async () => {
  clearProdEnv()
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  assertEquals(isProd(), false)
  assertEquals(await verifyTelnyx("body", "sig", "123"), true)
})

Deno.test("C3: FAILS CLOSED when no public key in prod (DENO_DEPLOYMENT_ID)", async () => {
  clearProdEnv()
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  Deno.env.set("DENO_DEPLOYMENT_ID", "abc123")
  assertEquals(isProd(), true)
  // Unset key + prod => reject, never silently accept a forged webhook.
  assertEquals(await verifyTelnyx("body", "sig", "123"), false)
  clearProdEnv()
})

Deno.test("C3: FAILS CLOSED when no public key in prod (DEMO_ENV=production)", async () => {
  clearProdEnv()
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  Deno.env.set("DEMO_ENV", "production")
  assertEquals(isProd(), true)
  assertEquals(await verifyTelnyx("body", "sig", "123"), false)
  clearProdEnv()
})

Deno.test("verifyTelnyx: fails closed on missing headers when a key IS set", async () => {
  // A syntactically valid base64 Ed25519 key (32 bytes). Verification will fail
  // because sig/timestamp are missing, proving fail-closed behavior.
  Deno.env.set("TELNYX_PUBLIC_KEY", btoa(String.fromCharCode(...new Uint8Array(32))))
  assertEquals(await verifyTelnyx("body", null, null), false)
  Deno.env.delete("TELNYX_PUBLIC_KEY")
})

Deno.test("verifyTelnyx: fails on a bad signature when a key IS set", async () => {
  Deno.env.set("TELNYX_PUBLIC_KEY", btoa(String.fromCharCode(...new Uint8Array(32))))
  assertEquals(await verifyTelnyx("body", btoa("not-a-real-sig"), "123"), false)
  Deno.env.delete("TELNYX_PUBLIC_KEY")
})
