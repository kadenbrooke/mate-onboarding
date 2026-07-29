// Access codes for client-portal signup. Format MATE-XXXX-XXXX from a
// 31-char alphabet with ambiguous glyphs removed (no 0/O/1/I/L).
import { randomInt } from "crypto";

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateAccessCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join("");
  return `MATE-${block()}-${block()}`;
}

export function normalizeCode(input: string): string | null {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^MATE/, "");
  if (stripped.length !== 8) return null;
  if ([...stripped].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  return `MATE-${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

export type CodeState = "valid" | "claimed" | "expired";

export function codeState(
  row: { claimed_at: string | null; expires_at: string },
  now: Date
): CodeState {
  if (row.claimed_at) return "claimed";
  if (new Date(row.expires_at).getTime() < now.getTime()) return "expired";
  return "valid";
}
