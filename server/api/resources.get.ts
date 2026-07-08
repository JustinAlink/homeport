import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { getConfig } from '../utils/config'
import { splitServiceId } from '../utils/service-id'
import { demoResources } from '../utils/demo'

// Current CPU/memory limits of a container (read-tier — plain inspect).
// CPU/memory only: Healthcheck lives on the immutable Config and can't be
// live-updated, so it's out of scope here entirely.
// composeManaged flags that a compose file owns this container: a live limit
// change sticks to the container but the compose file wins on the next
// `compose up` — the UI surfaces that honestly (same as restart-policy).
export default defineEventHandler(async (event) => {
  const id = String(getQuery(event).id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected ?id' })

  if (getConfig().demo) return demoResources(id)

  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const inspect = await getDockerFor(host).getContainer(containerId).inspect(oneShot())
    const hc = inspect.HostConfig || {}
    return {
      cpuShares: hc.CpuShares || 0,
      cpuQuota: hc.CpuQuota || 0,
      cpuPeriod: hc.CpuPeriod || 0,
      cpusetCpus: hc.CpusetCpus || '',
      memory: hc.Memory || 0,
      memoryReservation: hc.MemoryReservation || 0,
      memorySwap: hc.MemorySwap ?? 0,
      composeManaged: !!inspect.Config?.Labels?.['com.docker.compose.project'],
    }
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: e?.message || 'inspect failed' })
  }
})
