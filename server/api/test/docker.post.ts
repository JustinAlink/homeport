import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { getDockerFor } from '../../utils/docker'

// Test the Docker connection for each host: ping + engine version.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) {
    return { hosts: getHosts().map((h) => ({ name: h.name, ok: true, message: 'demo (Docker 27.0.0)' })) }
  }
  const hosts = await Promise.all(
    getHosts().map(async (h) => {
      try {
        const docker = getDockerFor(h)
        await docker.ping()
        const v: any = await docker.version()
        return { name: h.name, ok: true, message: `Docker ${v?.Version || '?'}` }
      } catch (e: any) {
        return { name: h.name, ok: false, message: e?.message || 'connection failed' }
      }
    }),
  )
  return { hosts }
})
