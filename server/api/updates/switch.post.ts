import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { switchVersion } from '../../utils/updates'
import { demoApplyUpdate, demoSwitchTag } from '../../utils/demo'

// Move a standalone container to another tag of its image (10.9.6 → 10.10.3):
// pull the tag, recreate with the same settings, roll back if it won't start.
// Containers in a managed stack change version in their compose file instead
// (service-settings), so the stack stays the source of truth.
// Gated behind HOMEPORT_ALLOW_UPDATES, like applying an update.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowUpdates && !cfg.demo) {
    throw createError({ statusCode: 403, statusMessage: 'Applying updates is disabled (HOMEPORT_ALLOW_UPDATES=true to enable).' })
  }

  const body = await readBody<{ id?: string; tag?: string; name?: string; image?: string }>(event)
  const id = body?.id
  const tag = String(body?.tag || '').trim()
  if (!id || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw createError({ statusCode: 400, statusMessage: 'Expected { id, tag }' })

  if (cfg.demo) {
    await new Promise((r) => setTimeout(r, 1500))
    if (body.name) demoSwitchTag(body.name, tag)
    return { ok: true, steps: demoApplyUpdate(body?.image || '') }
  }

  const sep = id.indexOf('::')
  const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
  const containerId = sep >= 0 ? id.slice(sep + 2) : id
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const { steps, newId } = await switchVersion(host, containerId, tag)
    return { ok: true, steps, newId }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode === 409 ? 409 : 502,
      statusMessage: err?.message || 'version switch failed',
      data: { steps: err?.steps },
    })
  }
})
