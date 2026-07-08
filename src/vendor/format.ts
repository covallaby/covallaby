// Vendored from covallaby/covallaby (core/src/thresholds.ts (formatPercent)) until packages publish to npm. Do not edit here.
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  // One decimal, floor — 84.97% must not round up past an 85% gate.
  return `${(Math.floor(value * 10) / 10).toFixed(1)}%`;
}
