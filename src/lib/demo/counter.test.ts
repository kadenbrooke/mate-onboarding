import { describe, it, expect, vi } from "vitest"
import { bumpCounter } from "./counter"
import type { SupabaseClient } from "@supabase/supabase-js"

function clientReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("bumpCounter (H1 / C2 atomic gate)", () => {
  it("passes scope/key/cap through to the demo_counter_bump RPC", async () => {
    const { client, rpc } = clientReturning({ data: true, error: null })
    await bumpCounter(client, "demo_start_global", "-", 200)
    expect(rpc).toHaveBeenCalledWith("demo_counter_bump", {
      p_scope: "demo_start_global",
      p_key: "-",
      p_cap: 200,
    })
  })

  it("returns true when the RPC allowed the increment", async () => {
    const { client } = clientReturning({ data: true, error: null })
    expect(await bumpCounter(client, "s", "k", 5)).toBe(true)
  })

  it("returns false when the RPC reports the cap was reached", async () => {
    const { client } = clientReturning({ data: false, error: null })
    expect(await bumpCounter(client, "s", "k", 5)).toBe(false)
  })

  it("FAILS CLOSED (false) when the RPC errors — a broken breaker must not open the gate", async () => {
    const { client } = clientReturning({ data: null, error: { message: "boom" } })
    expect(await bumpCounter(client, "s", "k", 5)).toBe(false)
  })

  it("treats any non-true data as blocked (defensive)", async () => {
    const { client } = clientReturning({ data: null, error: null })
    expect(await bumpCounter(client, "s", "k", 5)).toBe(false)
  })
})
