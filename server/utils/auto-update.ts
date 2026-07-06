import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { hostname } from 'node:os'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { listContainersFor } from './docker'
import { getUpdateMap, runUpdateSweep, applyUpdate } from './updates'
import { listStackDirs, runStackOp } from './stacks'
import { dispatch } from './alerts'
import { isAutoUpdateDue, planAutoUpdate } from './auto-update-core'
import { guard } from './guard'
import { log } from './log'

// Scheduled automatic updates: once per day, in the configured hour, refresh
// the update cache and apply updates to everything opted in (target list or
// `hub.autoupdate=true` label). Managed stacks go through `compose pull && up`;
// everything else gets the direct pull + recreate. homeport itself is skipped.
// Results are pushed through the alert channels and land in the alert log.

const stateFile = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'auto-update.json')

function loadState(): { lastDay?: string } {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveState(s: { lastDay?: string }) {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(s))
  } catch {
    // read-only data dir — the in-process guard still prevents same-boot reruns
  }
}

let ranDayInMem: string | undefined // fallback when the state file isn't writable

async function notify(name: string, host: string, ok: boolean, error: string) {
  try {
    await dispatch({ id: `auto|${host}|${name}`, name, host, kind: 'updated', from: 'auto-update', to: ok ? '' : error, at: Date.now() })
  } catch {
    // notification failure never blocks the update run
  }
}

export const maybeAutoUpdate = guard(async () => {
  const cfg = getConfig()
  if (cfg.demo || !cfg.autoUpdateEnabled || !cfg.allowUpdates || !cfg.updateCheckEnabled) return

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const lastDay = loadState().lastDay ?? ranDayInMem
  if (!isAutoUpdateDue(now.getHours(), cfg.autoUpdateHour, lastDay, todayKey)) return

  // mark first — a crash mid-run must not retry-loop for the rest of the hour
  ranDayInMem = todayKey
  saveState({ lastDay: todayKey })

  await runUpdateSweep(true) // fresh digests before deciding anything
  const map = getUpdateMap()
  const hosts = getHosts()
  const managed = cfg.allowStacks ? listStackDirs().map((d) => d.name) : []

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]
    let containers
    try {
      containers = await listContainersFor(host)
    } catch (e) {
      // Scheduled + unattended: a silently-skipped host is the worst case — the
      // user thinks auto-update ran. Say so.
      log.warn('auto-update', `skipping host "${host.name}" — could not list containers`, e)
      continue
    }
    const candidates = containers
      .filter((c) => map[`${host.id}|${c.image}`]?.status === 'update')
      .map((c) => ({ id: c.id, name: c.name, image: c.image, project: c.project, labels: c.labels }))

    const plan = planAutoUpdate({
      candidates,
      targets: cfg.autoUpdateTargets,
      managedStacks: i === 0 ? managed : [], // the compose CLI only reaches the primary host
      selfIdPrefix: hostname(), // inside a container, hostname = own short container id
    })

    for (const stack of plan.stacks) {
      const lines: string[] = []
      let ok = false
      try {
        ok = await runStackOp(stack, 'pull', (l) => lines.push(l))
      } catch (e: any) {
        lines.push(e?.message || String(e))
      }
      // Durable trail — the op buffer is ephemeral and this runs unattended overnight.
      if (ok) log.info('auto-update', `updated stack "${stack}" on ${host.name}`)
      else log.error('auto-update', `stack "${stack}" on ${host.name} failed`, lines.at(-1) || 'compose pull failed')
      await notify(`stack ${stack}`, host.name, ok, lines.at(-1) || 'compose pull failed')
    }
    for (const c of plan.directs) {
      try {
        await applyUpdate(host, c.id)
        log.info('auto-update', `updated "${c.name}" on ${host.name}`)
        await notify(c.name, host.name, true, '')
      } catch (e: any) {
        log.error('auto-update', `"${c.name}" on ${host.name} failed`, e)
        await notify(c.name, host.name, false, e?.message || 'update failed')
      }
    }
  }
})
