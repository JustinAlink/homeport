import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { splitServiceId } from '../../utils/service-id'
import { disconnectContainerFor } from '../../utils/networks'
import { demoNetworkDisconnect } from '../../utils/demo'

// Detach a container from a network. Refuses the container's last network.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ network?: string; id?: string }>(event)
  const network = String(body?.network || '').trim()
  const id = String(body?.id || '').trim()
  if (!network || !id) throw createError({ statusCode: 400, statusMessage: 'Expected { network, id }' })

  if (cfg.demo) return demoNetworkDisconnect(network, id)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    const { hostId, containerId } = splitServiceId(id)
    const host = getHosts().find((h) => h.id === hostId)
    if (!host) throw new Error('unknown host')
    await disconnectContainerFor(host, network, containerId)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not detach the container' })
  }
  return { ok: true }
})
