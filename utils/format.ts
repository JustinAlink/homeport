/** Human-readable bytes (binary units). Auto-imported by Nuxt. */
export function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GiB'
  if (b >= 1024 ** 2) return Math.round(b / 1024 ** 2) + ' MiB'
  if (b >= 1024) return Math.round(b / 1024) + ' KiB'
  return Math.round(b) + ' B'
}

/** Why a domain's status says "via proxy" (server/utils/ping-core.ts). */
export const VIA_PROXY_NOTE =
  "Checked through your reverse proxy: this server's public address can't be reached from inside Docker (no NAT loopback, or a firewall), so homeport asked the proxy directly. The app and its proxy route work; reachability from the internet wasn't tested."
