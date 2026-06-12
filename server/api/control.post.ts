import { getConfig } from '../utils/config'
import { controlContainerFor } from '../utils/docker'
import { getHosts } from '../utils/hosts'
import { splitServiceId } from '../utils/service-id'
import { demoControl } from '../utils/demo'

const ACTIONS = ['start', 'stop', 'restart'] as const
type Action = (typeof ACTIONS)[number]

// Start/stop/restart a container. Disabled unless HOMEPORT_ALLOW_CONTROL=true.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowControl) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (set HOMEPORT_ALLOW_CONTROL=true).' })
  }

  const body = await readBody<{ id?: string; action?: Action }>(event)
  const id = body?.id
  const action = body?.action
  if (!id || !action || !ACTIONS.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { id, action: "start" | "stop" | "restart" }' })
  }

  try {
    if (cfg.demo) {
      demoControl(id, action)
      return { ok: true }
    }
    const { hostId, containerId } = splitServiceId(id)
    const host = getHosts().find((h) => h.id === hostId)
    if (!host) throw new Error('unknown host')
    await controlContainerFor(host, containerId, action)
    return { ok: true }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Could not ${action} container: ${err?.message || err}` })
  }
})
