import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { applyUpdate } from '../../utils/updates'
import { demoApplyUpdate } from '../../utils/demo'

// Apply an image update to one container: pull → recreate → swap (with rollback).
// Gated behind HOMEPORT_ALLOW_UPDATES.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowUpdates && !cfg.demo) {
    throw createError({ statusCode: 403, statusMessage: 'Applying updates is disabled (HOMEPORT_ALLOW_UPDATES=true to enable).' })
  }

  const body = await readBody<{ id?: string; image?: string }>(event)
  const id = body?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected { id }' })

  if (cfg.demo) {
    await new Promise((r) => setTimeout(r, 1500)) // make the op feel real in the UI
    return { ok: true, steps: demoApplyUpdate(body?.image || '') }
  }

  const sep = id.indexOf('::')
  const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
  const containerId = sep >= 0 ? id.slice(sep + 2) : id
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const steps = await applyUpdate(host, containerId)
    return { ok: true, steps }
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: err?.message || 'update failed',
      data: { steps: err?.steps },
    })
  }
})
