import { getConfig } from '../utils/config'
import { controlContainer } from '../utils/docker'
import { demoControl } from '../utils/demo'

// Start/stop a container. Disabled unless HOMEPORT_ALLOW_CONTROL=true.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowControl) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (set HOMEPORT_ALLOW_CONTROL=true).' })
  }

  const body = await readBody<{ id?: string; action?: 'start' | 'stop' }>(event)
  const id = body?.id
  const action = body?.action
  if (!id || (action !== 'start' && action !== 'stop')) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { id, action: "start" | "stop" }' })
  }

  try {
    if (cfg.demo) demoControl(id, action)
    else await controlContainer(id, action)
    return { ok: true }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Could not ${action} container: ${err?.message || err}` })
  }
})
