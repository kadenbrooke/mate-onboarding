import { z } from "zod"

export type Collected = Record<string, unknown>
export interface ToolCall { tool: string; args: Record<string, any> }

// Pure reducer: applies a tool call to the collected state. Unit-testable, no I/O.
export function applyToolResult(collected: Collected, call: ToolCall): Collected {
  switch (call.tool) {
    case "saveField": return { ...collected, [call.args.key]: call.args.value }
    case "confirmServices": return { ...collected, services: call.args.services }
    case "setBrandVoice": return { ...collected, brand_voice: call.args.voice }
    default: return collected
  }
}

// Vercel AI SDK tool schemas (wired in the route).
export const toolSchemas = {
  saveField: { description: "Save one collected field", parameters: z.object({ key: z.string(), value: z.string() }) },
  confirmServices: { description: "Confirm the service list", parameters: z.object({ services: z.array(z.string()) }) },
  setBrandVoice: { description: "Save brand voice descriptor", parameters: z.object({ voice: z.string() }) },
}
