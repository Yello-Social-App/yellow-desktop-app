/** 12480 → "12.5k"; small numbers untouched. */
export function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value);
}
