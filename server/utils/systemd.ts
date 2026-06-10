import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface SystemdUnit {
  unit: string
  load: string
  active: string // active | inactive | failed | activating | ...
  sub: string // running | exited | dead | failed | ...
  description: string
}

/** Parse `systemctl … --output=json`. Pure — unit-tested. */
export function parseSystemctlJson(json: string): SystemdUnit[] {
  let arr: any
  try {
    arr = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((u) => ({
      unit: String(u.unit ?? ''),
      load: String(u.load ?? ''),
      active: String(u.active ?? ''),
      sub: String(u.sub ?? ''),
      description: String(u.description ?? ''),
    }))
    .filter((u) => u.unit.endsWith('.service'))
}

/**
 * List host systemd services via `systemctl`. Best-effort: returns [] if systemctl
 * isn't reachable (e.g. running in a container without host systemd access).
 * With a `filter` list → just those units; otherwise active + failed services.
 */
export async function listSystemdServices(filter: string[]): Promise<SystemdUnit[]> {
  try {
    const { stdout } = await exec(
      'systemctl',
      ['list-units', '--type=service', '--all', '--no-pager', '--output=json'],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
    )
    let units = parseSystemctlJson(stdout)
    if (filter.length) {
      const want = new Set(filter.flatMap((f) => [f, f.endsWith('.service') ? f : `${f}.service`]))
      units = units.filter((u) => want.has(u.unit) || want.has(u.unit.replace(/\.service$/, '')))
    } else {
      units = units.filter((u) => u.active === 'active' || u.active === 'failed')
    }
    return units
  } catch {
    return []
  }
}
