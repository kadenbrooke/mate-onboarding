import { assertEquals } from "jsr:@std/assert@1"
import {
  authenticateWebhook,
  timingSafeEqual,
  tokenMatches,
} from "../_shared/webhook-auth.ts"

const TOKEN_ENV = "DEMO_TEST_TOKEN"

// Clean prod/key env so verifyTelnyx behaves predictably per test.
function clearEnv() {
  Deno.env.delete("DENO_DEPLOYMENT_ID")
  Deno.env.delete("DEMO_ENV")
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  Deno.env.delete(TOKEN_ENV)
}

function texmlPost(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "From=%2B18015551234&To=%2B13854409744&CallSid=abc",
  })
}

Deno.test("timingSafeEqual: equal strings match, different do not", () => {
  assertEquals(timingSafeEqual("secret-token", "secret-token"), true)
  assertEquals(timingSafeEqual("secret-token", "secret-tokeX"), false)
  assertEquals(timingSafeEqual("short", "muchlongervalue"), false)
  assertEquals(timingSafeEqual("", ""), true)
})

Deno.test("tokenMatches: matches correct ?k, rejects wrong/absent", () => {
  clearEnv()
  Deno.env.set(TOKEN_ENV, "s3cret")
  assertEquals(tokenMatches(new Request("https://x.dev/fn?k=s3cret"), TOKEN_ENV), true)
  assertEquals(tokenMatches(new Request("https://x.dev/fn?k=wrong"), TOKEN_ENV), false)
  assertEquals(tokenMatches(new Request("https://x.dev/fn"), TOKEN_ENV), false)
  clearEnv()
})

Deno.test("tokenMatches: unset env => path unavailable (never opens)", () => {
  clearEnv()
  // Env unset; even an empty-looking ?k must not authenticate.
  assertEquals(tokenMatches(new Request("https://x.dev/fn?k="), TOKEN_ENV), false)
  assertEquals(tokenMatches(new Request("https://x.dev/fn?k=anything"), TOKEN_ENV), false)
  clearEnv()
})

Deno.test("authenticateWebhook: valid token allows (no signature needed)", async () => {
  clearEnv()
  Deno.env.set(TOKEN_ENV, "abc123")
  const req = texmlPost("https://x.supabase.co/functions/v1/demo-voice?k=abc123")
  assertEquals(await authenticateWebhook(req, "From=%2B1&To=%2B2", TOKEN_ENV), true)
  clearEnv()
})

Deno.test("authenticateWebhook: no token + no signature in PROD => rejected", async () => {
  clearEnv()
  Deno.env.set("DENO_DEPLOYMENT_ID", "deploy-xyz") // simulate prod
  Deno.env.set(TOKEN_ENV, "abc123")
  // Wrong token, and no Ed25519 headers, in prod => fail closed.
  const req = texmlPost("https://x.supabase.co/functions/v1/demo-voice?k=WRONG")
  assertEquals(await authenticateWebhook(req, "From=%2B1", TOKEN_ENV), false)
  clearEnv()
})

Deno.test("authenticateWebhook: token unset + no signature in PROD => rejected", async () => {
  clearEnv()
  Deno.env.set("DENO_DEPLOYMENT_ID", "deploy-xyz")
  // Token env unset (path unavailable) + no signature + prod => fail closed.
  const req = texmlPost("https://x.supabase.co/functions/v1/demo-voice?k=whatever")
  assertEquals(await authenticateWebhook(req, "From=%2B1", TOKEN_ENV), false)
  clearEnv()
})

Deno.test("authenticateWebhook: falls back to Ed25519 dev-skip when not prod, no token", async () => {
  clearEnv()
  // Not prod, no TELNYX_PUBLIC_KEY => verifyTelnyx dev-skips (returns true). Token
  // path unavailable, so this exercises the signature fallback branch locally.
  const req = texmlPost("https://x.supabase.co/functions/v1/demo-voice")
  assertEquals(await authenticateWebhook(req, "From=%2B1", TOKEN_ENV), true)
  clearEnv()
})
