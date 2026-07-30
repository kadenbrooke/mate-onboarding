// ---------------------------------------------------------------------------
// Dash chrome helpers -- pure functions behind the top bar + icon rail.
// ---------------------------------------------------------------------------

export type DashNavKey = 'dashboard' | 'leads' | 'assistant';

/** Which top-nav pill is active for the current pathname. */
export function activeNavKey(pathname: string): DashNavKey {
  if (/\/assistant\/?$/.test(pathname)) return 'assistant';
  return /\/leads\/?$/.test(pathname) ? 'leads' : 'dashboard';
}

/**
 * Two-letter initials for the avatar chip. Prefers the capital letters the
 * business already spells itself with ("J&C Asphalt" -> "JC", "Auto Mate"
 * -> "AM"), falling back to first letters of the first two words.
 */
export function businessInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '--';
  const caps = trimmed.match(/[A-Z]/g) ?? [];
  if (caps.length >= 2) return caps.slice(0, 2).join('');
  const words = trimmed.split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w));
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/** Sections the left icon rail scrolls to, in page order. */
export const RAIL_SECTIONS = [
  { id: 'zone-leadflow', label: 'Lead flow' },
  { id: 'zone-speed', label: 'Speed to lead' },
  { id: 'zone-ads', label: 'Ad performance' },
  { id: 'zone-followup', label: 'Follow-up engine' },
  { id: 'zone-reputation', label: 'Reputation' },
  { id: 'zone-calendar', label: 'Calendar' },
] as const;
