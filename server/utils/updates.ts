import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { getConfig } from './config'
import { getHosts, type HostConfig } from './hosts'
import { getDockerFor, listContainersFor } from './docker'
import { parseImageRef, digestMatches, pickDueChecks, type UpdateEntry } from './registry-core'
import { buildCreatePayload, type ApplyStep } from './recreate-core'
import { guard } from './guard'

// Image update detection + apply.
// Detection is DAEMON-side: GET /distribution/{image}/json (dockerode
// image.distribution()) makes the daemon ask the registry for the current digest —
// no hand-rolled registry auth, works with whatever the daemon can pull. Needs
// DISTRIBUTION=1 on the socket proxy. Results cached to <data>/updates.json.
// Apply (gated separately): pull, then watchtower-style stop→rename→create→start
// with a rename-back rollback. Compose-managed services will route through the
// stack runner once stacks land.

const BATCH_PER_SWEEP = 10

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'updates.json')

let cache: Record<string, UpdateEntry> | null = null
let writable: boolean | null = null

function canWrite(): boolean {
  if (writable !== null) return writable
  try {
    let p = dirname(file())
    while (!existsSync(p)) {
      const parent = dirname(p)
      if (parent === p) return (writable = false)
      p = parent
    }
    accessSync(p, constants.W_OK)
    writable = true
  } catch {
    writable = false
  }
  return writable
}

function load(): Record<string, UpdateEntry> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

function persist() {
  if (!canWrite()) return
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(cache ?? {}))
  } catch {
    // best-effort
  }
}

const keyOf = (hostId: string, image: string) => `${hostId}|${image}`

/** Current update map (keyed `${hostId}|${image}`). */
export function getUpdateMap(): Record<string, UpdateEntry> {
  return load()
}

async function checkImage(host: HostConfig, image: string, now: number): Promise<UpdateEntry> {
  const ref = parseImageRef(image)
  if (ref.digestPinned) return { status: 'pinned', checkedAt: now }

  const docker = getDockerFor(host)
  try {
    const local: any = await docker.getImage(image).inspect()
    const repoDigests: string[] = local?.RepoDigests || []
    if (!repoDigests.length) return { status: 'local', checkedAt: now } // built locally — nothing to compare

    const dist: any = await (docker.getImage(image) as any).distribution()
    const remoteDigest: string = dist?.Descriptor?.digest || ''
    if (!remoteDigest) return { status: 'error', checkedAt: now, error: 'registry returned no digest' }

    const localDigest = repoDigests[0]?.split('@')[1]
    return {
      status: digestMatches(repoDigests, remoteDigest) ? 'current' : 'update',
      localDigest,
      remoteDigest,
      checkedAt: now,
    }
  } catch (e: any) {
    return { status: 'error', checkedAt: now, error: e?.message || String(e) }
  }
}

/** One throttled sweep across all hosts (called from the collector tick + check-now). */
export const runUpdateSweep = guard(async (force = false) => {
  const cfg = getConfig()
  if (!cfg.updateCheckEnabled || cfg.demo) return
  const now = Date.now()
  const intervalMs = cfg.updateCheckIntervalH * 3600 * 1000
  const map = load()

  for (const host of getHosts()) {
    let images: string[]
    try {
      images = [...new Set((await listContainersFor(host)).map((c) => c.image))]
    } catch {
      continue // host down — skip
    }
    const keys = images.map((i) => keyOf(host.id, i))
    const cacheView: Record<string, UpdateEntry | undefined> = {}
    keys.forEach((k, i) => (cacheView[images[i]] = map[k]))

    const due = force ? images : pickDueChecks(images, cacheView, now, intervalMs, BATCH_PER_SWEEP)
    for (const image of due) {
      map[keyOf(host.id, image)] = await checkImage(host, image, now)
    }
  }

  cache = map
  persist()
})

/** Apply an image update to a standalone container: pull → recreate → swap. */
export async function applyUpdate(host: HostConfig, containerId: string): Promise<ApplyStep[]> {
  const docker = getDockerFor(host)
  const steps: ApplyStep[] = []
  const fail = (msg: string) => {
    const e: any = new Error(msg)
    e.steps = steps // endpoint surfaces partial progress on failure
    return e
  }
  const step = (s: string, ok: boolean, detail?: string) => {
    steps.push({ step: s, ok, detail })
    if (!ok) throw fail(`${s}: ${detail || 'failed'}`)
  }

  const container = docker.getContainer(containerId)
  let inspect: any
  try {
    inspect = await container.inspect()
    step('inspect', true)
  } catch (e: any) {
    step('inspect', false, e?.message)
  }

  // Compose-managed containers must be updated through their stack — recreating
  // one here would desync it from `docker compose` (label/hash drift, orphaning).
  const project = inspect.Config?.Labels?.['com.docker.compose.project']
  if (project) {
    const cname = String(inspect.Name || '').replace(/^\//, '')
    throw fail(`${cname} is part of the "${project}" compose stack — update it from Stacks → ${project} → Pull & up.`)
  }

  const image = inspect.Config?.Image
  const wasRunning = !!inspect.State?.Running
  const plan = buildCreatePayload(inspect, image)
  const backupName = `${plan.name}-old-${Date.now()}`

  // 1. pull the fresh image
  try {
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (err: any, stream: any) => {
        if (err) return reject(err)
        docker.modem.followProgress(stream, (e: any) => (e ? reject(e) : resolve()))
      })
    })
    step('pull', true, image)
  } catch (e: any) {
    step('pull', false, e?.message)
  }

  // 2. stop + rename the old container out of the way
  try {
    if (wasRunning) await container.stop()
    await container.rename({ name: backupName })
    step('stop + rename old', true, backupName)
  } catch (e: any) {
    step('stop + rename old', false, e?.message)
  }

  // 3. create + start the replacement (rollback = rename back + restart)
  try {
    const created = await docker.createContainer({ name: plan.name, ...plan.config } as any)
    for (const [net, epCfg] of Object.entries(plan.extraNetworks)) {
      try {
        await docker.getNetwork(net).connect({ Container: created.id, EndpointConfig: epCfg })
      } catch {
        steps.push({ step: `connect network ${net}`, ok: false, detail: 'kept going — verify manually' })
      }
    }
    await created.start()
    step('create + start new', true)
  } catch (e: any) {
    steps.push({ step: 'create + start new', ok: false, detail: e?.message })
    // rollback
    try {
      await docker.getContainer(backupName).rename({ name: plan.name })
      if (wasRunning) await docker.getContainer(plan.name).start()
      steps.push({ step: 'rollback (rename back + start)', ok: true })
    } catch (re: any) {
      steps.push({ step: 'rollback', ok: false, detail: `MANUAL FIX NEEDED: old container is "${backupName}" — ${re?.message}` })
    }
    throw fail(`update failed: ${e?.message}`)
  }

  // 4. success — remove the old container
  try {
    await docker.getContainer(backupName).remove({ force: true })
    step('remove old', true)
  } catch (e: any) {
    steps.push({ step: 'remove old', ok: false, detail: `leftover container "${backupName}": ${e?.message}` })
  }

  return steps
}
