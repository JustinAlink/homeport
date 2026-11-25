// Pure verdict behind /healthz, kept free of Docker and Nitro imports so it can be
// unit-tested. It judges the collector's last snapshot instead of pinging Docker
// itself: the healthcheck then costs nothing (no SSH session per probe on remote
// hosts) and also catches a collector that has stopped, which is what silently
// ends history and alerts.

export type HealthStatus = 'ok' | 'starting' | 'docker-unreachable' | 'collector-stalled'

export interface HealthSnapshot {
  at: number
  hostsOnline: Record<string, boolean>
}

export interface HealthVerdict {
  ok: boolean
  status: HealthStatus
}

/** How long a snapshot may age before the collector counts as stalled. Generous on
 *  purpose: a tick that runs an auto-update holds the guard for the whole pull, and a
 *  slow update must not read as a dead homeport. */
export const staleAfterMs = (intervalMs: number) => Math.max(10 * intervalMs, 30 * 60_000)

/** Grace before the first snapshot exists (boot, or a first tick that failed). */
export const startupGraceMs = (intervalMs: number) => Math.max(3 * intervalMs, 120_000)

export function healthOf(
  snap: HealthSnapshot | null,
  now: number,
  intervalMs: number,
  bootAt: number,
): HealthVerdict {
  if (!snap) {
    return now - bootAt < startupGraceMs(intervalMs)
      ? { ok: true, status: 'starting' }
      : { ok: false, status: 'collector-stalled' }
  }
  if (now - snap.at > staleAfterMs(intervalMs)) return { ok: false, status: 'collector-stalled' }
  // Healthy while any host answers: one unreachable remote in a multi-host setup is
  // shown on the dashboard, it does not make homeport itself unhealthy.
  if (!Object.values(snap.hostsOnline).some(Boolean)) return { ok: false, status: 'docker-unreachable' }
  return { ok: true, status: 'ok' }
}
