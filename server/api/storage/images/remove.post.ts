import { getConfig } from '../../../utils/config'
import { getHosts } from '../../../utils/hosts'
import { removeImageFor } from '../../../utils/storage'
import { demoImageRemove } from '../../../utils/demo'

// Delete an image (re-downloadable, unlike volumes). Refuses images any
// container still uses.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ id?: string }>(event)
  const id = String(body?.id || '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected { id }' })

  if (cfg.demo) return demoImageRemove(id)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    await removeImageFor(getHosts()[0], id)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not remove the image' })
  }
  return { ok: true }
})
