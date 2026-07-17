/**
 * Pure logic: given a session's `collected` blob, decide which pipeline
 * materials the onboarding has satisfied. Kept side-effect-free so it is unit
 * testable and reusable by the completion route.
 *
 * Mapping (Phase 1, mirrors .claude/rules/pipeline-material-auto-complete.md):
 *   - intake_form: the client told us who they are + what they sell
 *                  (company name + at least one service).
 *   - scope_lock:  services are confirmed AND brand voice is captured, i.e.
 *                  the working scope for the Mate is pinned down.
 *
 * The upsert into contact_materials happens in the route; this only derives the
 * material keys, never touches the DB.
 */
export function materialsForCollected(c: Record<string, any>): string[] {
  const keys: string[] = []
  if (
    c?.company?.name &&
    Array.isArray(c?.services) &&
    c.services.length
  ) {
    keys.push("intake_form")
  }
  if (Array.isArray(c?.services) && c.services.length && c?.brand_voice) {
    keys.push("scope_lock")
  }
  return keys
}
