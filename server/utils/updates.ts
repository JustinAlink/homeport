import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { getConfig } from './config'
import { getHosts, type HostConfig } from './hosts'
import { getDockerFor, listContainersFor, oneShot } from './docker'
import { parseImageRef, digestMatches, pickDueChecks, isBareImageId, authForImage, hasExplicitTag, pinnedDigest, pullInterruptedByPrune, PRUNE_INTERRUPTED_HINT, type UpdateEntry } from './registry-core'
import { buildCreatePayload, type ApplyStep } from './recreate-core'
import { listStackDirs } from './stacks'
import { dispatch } from './alerts'
import { guard } from './guard'
import { createContainerLock, ContainerBusyError } from './container-lock-core'
import { findNewer, tagKindOf, withTag } from './versions-core'
import { listTags, tagDigest } from './versions'
import { log } from './log'

// Image update detection + apply.
// Detection is DAEMON-side: GET /distribution/{image}/json (dockerode
// image.distribution()) makes the daemon ask the registry for the current digest —
// no hand-rolled registry auth, works with whatever the daemon can pull. Needs
// DISTRIBUTION=1 on the socket proxy. Results cached to <data>/updates.json.
// Apply (gated separately): pull, then watchtower-style stop→rename→create→start
// with a rename-back rollback. Compose-managed services will route through the
// stack runner once stacks land.
// Newer VERSIONS (10.9.6 → 10.10.3) are a separate question the digest can't
// answer; versions.ts reads the registry's tag list for that.

const BATCH_PER_SWEEP = 10
const containerLock = createContainerLock()

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

/**
 * Newer-version info from the registry's tag list. Only tags that look like versions
 * are looked up (latest has nothing to compare). A failed lookup keeps the previous
 * answer for a week rather than flapping the "newer version" note on and off.
 */
async function versionInfo(image: string, tag: string, prev: UpdateEntry | undefined, now: number): Promise<Partial<UpdateEntry>> {
  if (tagKindOf(tag) === 'floating') return { tagKind: 'floating' }
  try {
    const creds = getConfig().registryCreds
    const tags = await listTags(image, creds)
    const found = findNewer(tag, tags)
    // a tag+digest pin (`x:1.2@sha256:…`) is bumped by pasting the new tag AND its
    // digest, so look those up for the offered versions (best-effort: no digest, no
    // copyable pin, the version is still shown)
    let rebuilt: UpdateEntry['rebuilt']
    if (parseImageRef(image).digestPinned) {
      for (const v of [found.newer, found.newerSameMajor]) {
        if (v) v.digest = (await tagDigest(image, v.tag, creds).catch(() => null)) ?? undefined
      }
      // the pin never moves, but its tag may have been rebuilt since it was taken
      const tagNow = await tagDigest(image, tag, creds).catch(() => null)
      if (tagNow && tagNow !== pinnedDigest(image)) rebuilt = { digest: tagNow }
    }
    return { tagKind: tagKindOf(tag, tags), ...found, ...(rebuilt ? { rebuilt } : {}), versionsCheckedAt: now }
  } catch {
    const fresh = prev?.versionsCheckedAt && now - prev.versionsCheckedAt < 7 * 24 * 3600_000
    return fresh
      ? { tagKind: prev.tagKind, newer: prev.newer, newerSameMajor: prev.newerSameMajor, rebuilt: prev.rebuilt, versionsCheckedAt: prev.versionsCheckedAt }
      : { tagKind: tagKindOf(tag) }
  }
}

async function checkImage(host: HostConfig, image: string, now: number, prev?: UpdateEntry): Promise<UpdateEntry> {
  const entry = await checkDigest(host, image, now)
  // a digest pin never gets a rebuild, but its TAG can still be behind (npm:2.16.0@sha256:…
  // while 2.17.0 is out): the pins that most need the newer-version check
  const pinnedWithTag = entry.status === 'pinned' && hasExplicitTag(image)
  if (entry.status !== 'current' && entry.status !== 'update' && !pinnedWithTag) return entry
  return { ...entry, ...(await versionInfo(image, parseImageRef(image).tag, prev, now)) }
}

async function checkDigest(host: HostConfig, image: string, now: number): Promise<UpdateEntry> {
  const ref = parseImageRef(image)
  if (ref.digestPinned) return { status: 'pinned', checkedAt: now }
  if (isBareImageId(image)) return { status: 'local', checkedAt: now } // untagged image — no repo to query

  const docker = getDockerFor(host)
  try {
    const local: any = await docker.getImage(image).inspect()
    const repoDigests: string[] = local?.RepoDigests || []
    if (!repoDigests.length) return { status: 'local', checkedAt: now } // built locally — nothing to compare

    const authconfig = authForImage(image, getConfig().registryCreds)
    const dist: any = await (docker.getImage(image) as any).distribution({ ...oneShot(), authconfig })
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
    return { status: 'error', checkedAt: now, error: friendlyCheckError(e) }
  }
}

/**
 * Turn a raw daemon/proxy error into something actionable. The common one is a
 * 403 from docker-socket-proxy ("Request forbidden by administrative rules")
 * when DISTRIBUTION isn't allowed — the update check needs that endpoint.
 */
function friendlyCheckError(e: any): string {
  const raw = (e?.message || String(e || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (pullInterruptedByPrune(raw)) return `${PRUNE_INTERRUPTED_HINT} (${raw.slice(0, 120)})`
  if (/403/.test(raw) && /forbidden|administrative rules/i.test(raw)) {
    return 'Docker socket-proxy blocked the registry check. Add DISTRIBUTION=1 to the socket-proxy to enable update checks.'
  }
  if (/401/.test(raw) && /unauthorized|no such image/i.test(raw)) {
    return 'Registry denied the check (401). The image is private or the name is wrong — homeport checks anonymously, so make the package public or verify the image reference.'
  }
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw || 'check failed'
}

/** One throttled sweep across all hosts (called from the collector tick + check-now). */
export const runUpdateSweep = guard(async (force = false) => {
  const cfg = getConfig()
  if (!cfg.updateCheckEnabled || cfg.demo) return
  const now = Date.now()
  const intervalMs = cfg.updateCheckIntervalH * 3600 * 1000
  const map = load()
  const notify: { key: string; image: string; names: string; host: HostConfig; entry: UpdateEntry }[] = []

  for (const host of getHosts()) {
    let containers: Awaited<ReturnType<typeof listContainersFor>>
    try {
      containers = await listContainersFor(host)
    } catch (e) {
      log.warn('update-sweep', `skipping host "${host.name}" — could not list containers`, e)
      continue
    }
    const images = [...new Set(containers.map((c) => c.image))]
    const keys = images.map((i) => keyOf(host.id, i))
    const cacheView: Record<string, UpdateEntry | undefined> = {}
    keys.forEach((k, i) => (cacheView[images[i]] = map[k]))

    const due = force ? images : pickDueChecks(images, cacheView, now, intervalMs, BATCH_PER_SWEEP)
    for (const image of due) {
      const key = keyOf(host.id, image)
      const entry = await checkImage(host, image, now, map[key])
      entry.notifiedDigest = map[key]?.notifiedDigest // survives re-checks
      map[key] = entry
      if (
        cfg.alertsEnabled &&
        cfg.alertUpdates &&
        entry.status === 'update' &&
        entry.remoteDigest &&
        entry.notifiedDigest !== entry.remoteDigest
      ) {
        const names = containers.filter((c) => c.image === image).map((c) => c.name).join(', ')
        notify.push({ key, image, names: names || image, host, entry })
      }
    }
  }

  // one notification per newly-seen digest — never repeated on later sweeps
  for (const n of notify) {
    await dispatch({ id: n.key, name: n.names, host: n.host.name, kind: 'update', from: n.image, to: n.entry.remoteDigest!, at: now })
    n.entry.notifiedDigest = n.entry.remoteDigest
  }

  cache = map
  persist()
})

/** Apply an image update to a standalone container: pull → recreate → swap. */
export async function applyUpdate(host: HostConfig, containerId: string): Promise<{ steps: ApplyStep[]; newId: string }> {
  return swapContainer(host, containerId, { pull: true })
}

/** Move a standalone container to another tag of its image (10.9.6 → 10.10.3), same swap and rollback. */
export async function switchVersion(host: HostConfig, containerId: string, tag: string, digest?: string): Promise<{ steps: ApplyStep[]; newId: string }> {
  return swapContainer(host, containerId, { pull: true, tag, digest })
}

/** Recreate a container in place with a new environment (same image, no pull). */
export async function applyEnvChange(host: HostConfig, containerId: string, env: string[]): Promise<{ steps: ApplyStep[]; newId: string }> {
  return swapContainer(host, containerId, { pull: false, env })
}

/** Plain recreate: same image, same config — for containers in a weird state. */
export async function recreateContainer(host: HostConfig, containerId: string): Promise<{ steps: ApplyStep[]; newId: string }> {
  return swapContainer(host, containerId, { pull: false })
}

/** Shared stop → rename → create → start → remove machinery (rollback = rename back). */
async function swapContainer(
  host: HostConfig,
  containerId: string,
  opts: { pull: boolean; env?: string[]; tag?: string; digest?: string },
): Promise<{ steps: ApplyStep[]; newId: string }> {
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
  // `step` throws on failure, so we only get here on success — but don't leave the
  // rest of the swap depending on that side-effect to guard a raw null deref.
  if (!inspect) throw fail('inspect: no container data')

  // Compose-managed containers whose stack homeport manages must be updated
  // through the stack — recreating one here would desync it from what a later
  // `compose pull && up` deploys. Projects homeport has no compose file for
  // (started elsewhere) get the direct recreate: labels are copied over, so
  // compose keeps recognizing the container.
  const project = inspect.Config?.Labels?.['com.docker.compose.project']
  if (project && getConfig().allowStacks && listStackDirs().some((d) => d.name === project)) {
    const cname = String(inspect.Name || '').replace(/^\//, '')
    throw fail(
      opts.tag
        ? `${cname} is part of the "${project}" compose stack: change its version in the compose file (Stacks → ${project}).`
        : opts.pull
          ? `${cname} is part of the "${project}" compose stack — update it from Stacks → ${project} → Pull & up.`
          : `${cname} is part of the "${project}" compose stack — edit the environment in its compose file (Stacks → ${project}).`,
    )
  }

  const image = opts.tag ? withTag(inspect.Config?.Image, opts.tag) + (opts.digest ? `@${opts.digest}` : '') : inspect.Config?.Image
  const wasRunning = !!inspect.State?.Running
  // When the image changes (a pull or a version switch), settings that only came
  // from the old image must not be pinned onto the new one (stripImageDefaults).
  // Fail-open: without the old image's config the copy is as before.
  let oldImageConfig: Record<string, any> | undefined
  if (opts.pull) {
    try {
      oldImageConfig = (await docker.getImage(inspect.Image).inspect())?.Config ?? undefined
    } catch {
      oldImageConfig = undefined
    }
  }
  const plan = buildCreatePayload(inspect, image, { ...(opts.env ? { env: opts.env } : {}), ...(oldImageConfig ? { oldImageConfig } : {}) })
  const backupName = `${plan.name}-old-${Date.now()}`

  // one swap per container at a time (see container-lock-core): hold the live
  // name and the backup name, so a parallel update/env change/recreate can't
  // grab the renamed old container mid-swap
  const currentName = String(inspect.Name || '').replace(/^\//, '')
  const label = opts.tag ? 'a version switch' : opts.pull ? 'an update' : opts.env ? 'an environment change' : 'a recreate'
  const keys = [...new Set([plan.name, backupName, currentName])].map((n) => `${host.id}::${n}`)
  let newId = ''
  try {
    await containerLock.run(keys, label, async () => {
      // 1. pull the fresh image (updates only — env edits keep the current image)
      if (opts.pull) {
        try {
          const authconfig = authForImage(image, getConfig().registryCreds)
          await new Promise<void>((resolve, reject) => {
            docker.pull(image, {}, (err: any, stream: any) => {
              if (err) return reject(err)
              docker.modem.followProgress(stream, (e: any) => (e ? reject(e) : resolve()))
            }, authconfig)
          })
          step('pull', true, image)
        } catch (e: any) {
          // Same translation the check path uses — a private-image 401 or a
          // socket-proxy 403 here should read clearly, not as raw daemon text.
          step('pull', false, friendlyCheckError(e))
        }
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
        newId = created.id
        for (const [net, epCfg] of Object.entries(plan.extraNetworks)) {
          try {
            await docker.getNetwork(net).connect({ Container: created.id, EndpointConfig: epCfg })
          } catch (ne: any) {
            steps.push({ step: `connect network ${net}`, ok: false, detail: `kept going — verify manually (${ne?.message || ne})` })
          }
        }
        await created.start()
        step('create + start new', true)
      } catch (e: any) {
        steps.push({ step: 'create + start new', ok: false, detail: e?.message })
        // rollback
        let rolledBack = false
        try {
          await docker.getContainer(backupName).rename({ name: plan.name })
          if (wasRunning) await docker.getContainer(plan.name).start()
          steps.push({ step: 'rollback (rename back + start)', ok: true })
          rolledBack = true
        } catch (re: any) {
          steps.push({ step: 'rollback', ok: false, detail: `MANUAL FIX NEEDED: old container is "${backupName}" — ${re?.message}` })
        }
        // Surface the un-restored state in the message itself — not just buried in steps —
        // so a toast/log makes clear the service is DOWN and renamed, not merely "failed".
        throw fail(
          rolledBack
            ? `update failed: ${e?.message} (rolled back — the previous version is running again)`
            : `update failed and ROLLBACK FAILED: "${plan.name}" is down; its old container is "${backupName}" and must be restored manually`,
        )
      }

      // 4. success — remove the old container
      try {
        await docker.getContainer(backupName).remove({ force: true })
        step('remove old', true)
      } catch (e: any) {
        steps.push({ step: 'remove old', ok: false, detail: `leftover container "${backupName}": ${e?.message}` })
      }

      // reflect an applied update in the cache right away (badges clear without
      // waiting for the next 24h sweep) — env-only recreates change no image
      if (opts.pull) {
        const map = load()
        const k = keyOf(host.id, image)
        const entry = map[k]
        if (entry?.remoteDigest) {
          map[k] = { ...entry, status: 'current', localDigest: entry.remoteDigest, checkedAt: Date.now() }
          persist()
        } else if (opts.tag) {
          // a version switch lands on a tag that was never checked: check it now so the
          // container page isn't left saying "not checked yet" until the next sweep
          void checkImage(host, image, Date.now())
            .then((e) => {
              load()[k] = e
              persist()
            })
            .catch(() => {})
        }
      }
    })
  } catch (e: any) {
    if (e instanceof ContainerBusyError) {
      const busy = fail(e.message)
      busy.statusCode = 409 // a conflict, not a failure: the other operation is fine
      throw busy
    }
    throw e
  }

  return { steps, newId }
}
