import { assertEquals } from "jsr:@std/assert@1"
import { toE164, isPhoneCode } from "../_shared/normalize.ts"

Deno.test("toE164: caller-ID and form entry collapse to the same join key", () => {
  // The Telnyx webhook value and the number typed on the form MUST match.
  assertEquals(toE164("8015551234"), "+18015551234")
  assertEquals(toE164("+18015551234"), "+18015551234")
  assertEquals(toE164("(801) 555-1234"), "+18015551234")
  assertEquals(toE164("1 801 555 1234"), "+18015551234")
})

Deno.test("toE164: rejects junk", () => {
  assertEquals(toE164(""), null)
  assertEquals(toE164("abc"), null)
  assertEquals(toE164("12345"), null)
})

Deno.test("isPhoneCode: matches a 6-digit fallback code only (H4)", () => {
  assertEquals(isPhoneCode("123456"), true)
  assertEquals(isPhoneCode(" 123456 "), true)
  assertEquals(isPhoneCode("1234"), false)
  assertEquals(isPhoneCode("1234567"), false)
  assertEquals(isPhoneCode("hi"), false)
})
