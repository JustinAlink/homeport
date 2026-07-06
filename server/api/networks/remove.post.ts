import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { removeNetworkFor } from '../../utils/networks'
import { demoNetworkRemove } from '../../utils/demo'

// Remove an unused docker network (the one-click fix for compose "Pool
// overlaps" failures). Refuses built-ins and networks still referenced by any
// container — safe by construction. Gated behind stacks (its only UI surface).
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ name?: string }>(event)
  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Expected { name }' })

  if (cfg.demo) return demoNetworkRemove(name)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    await removeNetworkFor(getHosts()[0], name)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not remove the network' })
  }
  return { ok: true }
})
