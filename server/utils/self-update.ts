import { hostname } from 'node:os'
import { getHosts } from './hosts'
import { getDockerFor, oneShot } from './docker'
import { HELPER_LABEL, buildHelperPayload, selfUpdatePlan } from './self-update-core'
import { digestMatches } from './registry-core'
import { log } from './log'

// Self-update: find our own container (in-container hostname = short container
// id), validate it's compose-managed, and launch the detached helper that
// pulls + recreates the project from outside. See self-update-core.ts.

/** homeport's own container id on the primary host (null when not in Docker). */
export async function findSelfId(): Promise<string | null> {
  const short = hostname()
  if (!/^[0-9a-f]{12}$/.test(short)) return null
  try {
    const docker = getDockerFor(getHosts()[0])
    const list = await docker.listContainers({ all: false, ...oneShot() })
    return list.find((c: any) => c.Id.startsWith(short))?.Id ?? null
  } catch (e) {
    // Don't mask a real Docker error as "not containerized" silently.
    log.warn('self-update', 'could not list containers to find homeport itself', e)
    return null
  }
}

export async function launchSelfUpdate(): Promise<{ ok: true; helper: string } | { ok: false; reason: string }> {
  const selfId = await findSelfId()
  if (!selfId) return { ok: false, reason: 'homeport does not appear to be running in a container here' }

  const docker = getDockerFor(getHosts()[0])
  const inspect = await docker.getContainer(selfId).inspect(oneShot())
  const plan = selfUpdatePlan(inspect)
  if (!plan.ok) return plan

  // Already up to date? Ask the registry (best-effort — proceeds if the
  // check is unavailable, e.g. no DISTRIBUTION permission on the proxy).
  try {
    const dist: any = await (docker.getImage(plan.image) as any).distribution(oneShot())
    const remoteDigest = dist?.Descriptor?.digest
    const repoDigests: string[] = inspect.Image ? (await docker.getImage(plan.image).inspect(oneShot())).RepoDigests ?? [] : []
    if (remoteDigest && repoDigests.length && digestMatches(repoDigests, remoteDigest)) {
      return { ok: false, reason: 'already up to date — the registry has no newer image' }
    }
  } catch {
    // registry check unavailable — attempt the update anyway
  }

  // Remove exited helpers from previous runs (kept for debuggability).
  try {
    const old = await docker.listContainers({ all: true, filters: { label: [`${HELPER_LABEL}=true`] }, ...oneShot() })
    for (const c of old) {
      if (c.State !== 'running') await docker.getContainer(c.Id).remove({ force: false }).catch(() => {})
    }
  } catch {
    // best-effort cleanup
  }

  const payload = buildHelperPayload({
    image: plan.image,
    project: plan.project,
    projectDir: plan.projectDir,
    dockerHost: process.env.DOCKER_HOST || '',
    networks: plan.networks,
  })
  try {
    const helper = await docker.createContainer(payload as any)
    await helper.start()
    log.info('self-update', `launched updater "${payload.name}" for project "${plan.project}"`)
    return { ok: true, helper: payload.name }
  } catch (e: any) {
    log.error('self-update', 'failed to launch the updater container', e)
    return { ok: false, reason: `could not launch the updater: ${e?.message || e}` }
  }
}
