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
// Note: requestBuild is a side-effect (inserts a build_request), NOT a collected-field
// mutation, so applyToolResult deliberately does not handle it — the route does.
export const toolSchemas = {
  saveField: { description: "Save one collected field", parameters: z.object({ key: z.string(), value: z.string() }) },
  confirmServices: { description: "Confirm the service list", parameters: z.object({ services: z.array(z.string()) }) },
  setBrandVoice: { description: "Save brand voice descriptor", parameters: z.object({ voice: z.string() }) },
  requestBuild: { description: "Log an out-of-scope capability the client asked for that Mate cannot do", parameters: z.object({ request_text: z.string(), mate_summary: z.string() }) },
}
