import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { splitServiceId } from '../utils/service-id'
import { parseEnv } from '../utils/env-core'
import { demoEnv } from '../utils/demo'

// Read a container's environment for the editor. Secret-looking values are
// withheld (value: null) — they can be overwritten but not read back.
// Gated with the updates capability: editing env = the same recreate machinery.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const id = String(getQuery(event).id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected ?id=' })

  if (cfg.demo) return { env: demoEnv(id) }
  if (!cfg.allowUpdates) {
    throw createError({ statusCode: 403, statusMessage: 'Environment editing needs the updates capability (HOMEPORT_ALLOW_UPDATES=true).' })
  }

  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const inspect: any = await getDockerFor(host).getContainer(containerId).inspect(oneShot())
    return { env: parseEnv(inspect?.Config?.Env ?? []) }
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: e?.message || 'could not inspect the container' })
  }
})
