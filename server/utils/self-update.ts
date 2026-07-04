import { hostname } from 'node:os'
import { getHosts } from './hosts'
import { getDockerFor, oneShot } from './docker'
import { buildHelperPayload, selfUpdatePlan } from './self-update-core'

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
  } catch {
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

  const payload = buildHelperPayload({
    image: plan.image,
    project: plan.project,
    projectDir: plan.projectDir,
    dockerHost: process.env.DOCKER_HOST || '',
    networks: plan.networks,
  })
  const helper = await docker.createContainer(payload as any)
  await helper.start()
  return { ok: true, helper: payload.name }
}
