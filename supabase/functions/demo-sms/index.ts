// Edge-function entrypoint for demo-sms. All logic lives in handler.ts (tests
// import from there); this file does nothing but bind the listener — the same
// unconditional shape as before the BOTC divert, so the deployed entrypoint can
// never silently fail to serve (import.meta.main is edge-runtime-dependent).
import { handler } from "./handler.ts"

Deno.serve(handler)
