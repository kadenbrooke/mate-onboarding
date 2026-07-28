/** "$38.2k" above $10,000, plain "$9,500" below. */
export function moneyShort(cents: number): string {
  return cents >= 1_000_000
    ? `$${(cents / 100_000).toFixed(1)}k`
    : `$${Math.round(cents / 100).toLocaleString()}`;
}
