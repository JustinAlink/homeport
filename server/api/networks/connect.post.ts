import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { splitServiceId } from '../../utils/service-id'
import { connectContainerFor } from '../../utils/networks'
import { demoNetworkConnect } from '../../utils/demo'

// Attach a container to a network. Runtime-only by nature: a compose re-up
// resets memberships to what the compose file declares — the UI says so.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ network?: string; id?: string }>(event)
  const network = String(body?.network || '').trim()
  const id = String(body?.id || '').trim()
  if (!network || !id) throw createError({ statusCode: 400, statusMessage: 'Expected { network, id }' })

  if (cfg.demo) return demoNetworkConnect(network, id)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    const { hostId, containerId } = splitServiceId(id)
    const host = getHosts().find((h) => h.id === hostId)
    if (!host) throw new Error('unknown host')
    await connectContainerFor(host, network, containerId)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not attach the container' })
  }
  return { ok: true }
})
