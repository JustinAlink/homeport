/** Human-readable bytes (binary units). Auto-imported by Nuxt. */
export function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GiB'
  if (b >= 1024 ** 2) return Math.round(b / 1024 ** 2) + ' MiB'
  if (b >= 1024) return Math.round(b / 1024) + ' KiB'
  return Math.round(b) + ' B'
}
