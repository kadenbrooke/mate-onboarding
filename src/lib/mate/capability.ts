// The capability manifest is the set of things Mate can actually do for a client.
// A capability counts as usable only when its status is "live" — anything under
// construction or unknown is out of scope, so Mate declines and logs a build_request.
export interface Capability {
  capability_key: string
  label?: string
  status: string
}

export function isInManifest(manifest: Capability[], key: string): boolean {
  return manifest.some((c) => c.capability_key === key && c.status === "live")
}

// Build a short human-readable summary of LIVE capabilities for the system prompt,
// so Mate accurately knows what it CAN do before deciding whether to decline.
// Empty/none manifest => a neutral "na" string; Mate still declines genuinely new asks.
export function capabilitySummary(manifest: Capability[]): string {
  const live = manifest.filter((c) => c.status === "live")
  if (live.length === 0) return "na"
  const labels = live.map((c) => c.label?.trim() || c.capability_key)
  return `You can currently: ${labels.join(", ")}.`
}
