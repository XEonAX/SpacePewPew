/** Clamp a loaded/total pair into 0..1 for the boot progress bar. */
export function loadFraction(loaded: number, total: number): number {
  if (!(total > 0)) return 1;
  return Math.min(1, Math.max(0, loaded / total));
}

/** Percentage label used by the boot screen. */
export function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
