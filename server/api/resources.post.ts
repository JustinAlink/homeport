import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { getConfig } from '../utils/config'
import { splitServiceId } from '../utils/service-id'
import { demoSetResources } from '../utils/demo'
import { buildUpdateFields, mapResourcesError, type ResourcesInput } from '../utils/resources-core'

// Change a container's CPU/memory limits in place (docker update — no recreate,
// no downtime). Same trust tier as restart-policy/start/stop: control
// capability + POST=1 on the docker-socket-proxy. CPU + memory only — see
// resources-core.ts for why Healthcheck can't join this endpoint.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ id?: string } & ResourcesInput>(event)
  const id = String(body?.id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected { id, ...resource fields }' })

  let fields: ReturnType<typeof buildUpdateFields>
  try {
    fields = buildUpdateFields(body)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'invalid resource values' })
  }

  if (cfg.demo) {
    return demoSetResources(id, {
      cpuQuota: fields.CpuQuota,
      cpuPeriod: fields.CpuPeriod,
      cpusetCpus: fields.CpusetCpus,
      memory: fields.Memory,
      memoryReservation: fields.MemoryReservation,
      memorySwap: fields.MemorySwap,
    })
  }
  if (!cfg.allowControl) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (HOMEPORT_ALLOW_CONTROL=true to enable).' })
  }

  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    await getDockerFor(host).getContainer(containerId).update({ ...fields, ...oneShot() })
    return { ok: true }
  } catch (e: any) {
    const { statusCode, statusMessage } = mapResourcesError(e)
    throw createError({ statusCode, statusMessage })
  }
})
