import { getConfig } from '../utils/config'
import { controlContainerFor, getDockerFor, oneShot } from '../utils/docker'
import { getHosts } from '../utils/hosts'
import { splitServiceId } from '../utils/service-id'
import { deleteRoutesForUpstreams } from '../utils/proxy-admin/cleanup'
import { demoControl } from '../utils/demo'

const ACTIONS = ['start', 'stop', 'restart', 'remove'] as const
type Action = (typeof ACTIONS)[number]

// Start/stop/restart a container. Disabled unless HOMEPORT_ALLOW_CONTROL=true.
// 'remove' takes optional cleanup flags: volumes (anonymous), image, and
// proxyRoutes (delete reverse-proxy routes pointing at the container) —
// cleanup results come back as human-readable `notes`.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowControl) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (set HOMEPORT_ALLOW_CONTROL=true).' })
  }

  const body = await readBody<{ id?: string; action?: Action; volumes?: boolean; image?: boolean; proxyRoutes?: boolean }>(event)
  const id = body?.id
  const action = body?.action
  if (!id || !action || !ACTIONS.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { id, action: "start" | "stop" | "restart" }' })
  }

  try {
    if (cfg.demo) {
      demoControl(id, action)
      const notes: string[] = []
      if (action === 'remove' && body?.image) notes.push('removed image (demo)')
      if (action === 'remove' && body?.proxyRoutes) notes.push('removed proxy routes (demo)')
      return { ok: true, notes }
    }
    const { hostId, containerId } = splitServiceId(id)
    const host = getHosts().find((h) => h.id === hostId)
    if (!host) throw new Error('unknown host')

    // capture name + image ref before removal — needed for the cleanup steps
    let name = ''
    let imageRef = ''
    if (action === 'remove' && (body?.image || body?.proxyRoutes)) {
      const inspect = await getDockerFor(host).getContainer(containerId).inspect(oneShot())
      name = (inspect.Name || '').replace(/^\//, '')
      imageRef = inspect.Config?.Image || ''
    }

    await controlContainerFor(host, containerId, action, { volumes: !!body?.volumes })

    const notes: string[] = []
    if (action === 'remove' && body?.image && imageRef) {
      try {
        await getDockerFor(host).getImage(imageRef).remove()
        notes.push(`removed image ${imageRef}`)
      } catch (e: any) {
        notes.push(`image ${imageRef} kept: ${e?.message || e}`)
      }
    }
    if (action === 'remove' && body?.proxyRoutes && name) {
      await deleteRoutesForUpstreams([name], (l) => notes.push(l))
    }
    return { ok: true, notes }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Could not ${action} container: ${err?.message || err}` })
  }
})
