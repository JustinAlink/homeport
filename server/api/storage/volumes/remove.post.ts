import { getConfig } from '../../../utils/config'
import { getHosts } from '../../../utils/hosts'
import { removeVolumeFor } from '../../../utils/storage'
import { demoVolumeRemove } from '../../../utils/demo'

// Delete a volume — its data is gone for good. Refuses volumes any container
// still references (running or stopped). Gated like the other cleanup tools.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ name?: string }>(event)
  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Expected { name }' })

  if (cfg.demo) return demoVolumeRemove(name)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    await removeVolumeFor(getHosts()[0], name)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not remove the volume' })
  }
  return { ok: true }
})
