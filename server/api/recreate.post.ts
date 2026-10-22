import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { splitServiceId } from '../utils/service-id'
import { recreateContainer } from '../utils/updates'

// Recreate a container in place (same image, same config) — for containers in
// a wedged state. Control-gated: it's lifecycle, not an image or config change.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowControl && !cfg.demo) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (set HOMEPORT_ALLOW_CONTROL=true).' })
  }

  const body = await readBody<{ id?: string }>(event)
  const id = body?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected { id }' })

  if (cfg.demo) {
    await new Promise((r) => setTimeout(r, 1200))
    return {
      ok: true,
      steps: [
        { step: 'inspect', ok: true },
        { step: 'stop + rename old', ok: true },
        { step: 'create + start new', ok: true },
        { step: 'remove old', ok: true },
      ],
    }
  }

  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const { steps, newId } = await recreateContainer(host, containerId)
    return { ok: true, steps, newId }
  } catch (err: any) {
    throw createError({ statusCode: err?.statusCode === 409 ? 409 : 502, statusMessage: err?.message || 'recreate failed', data: { steps: err?.steps } })
  }
})
