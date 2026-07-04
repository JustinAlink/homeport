import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { getConfig } from '../utils/config'
import { demoRestartPolicy } from '../utils/demo'

// Current restart policy of a container (read-tier — plain inspect).
// composeManaged flags that a compose file owns this container: a live policy
// change sticks to the container but the compose file wins on the next
// `compose up` — the UI surfaces that honestly.
export default defineEventHandler(async (event) => {
  const id = String(getQuery(event).id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected ?id' })

  if (getConfig().demo) return demoRestartPolicy(id)

  const sep = id.indexOf('::')
  const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
  const cid = sep >= 0 ? id.slice(sep + 2) : id
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    const inspect = await getDockerFor(host).getContainer(cid).inspect(oneShot())
    return {
      policy: inspect.HostConfig?.RestartPolicy?.Name || 'no',
      composeManaged: !!inspect.Config?.Labels?.['com.docker.compose.project'],
    }
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: e?.message || 'inspect failed' })
  }
})
