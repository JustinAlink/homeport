import type { PingMap } from '~/types/service'
import { getConfig } from '../utils/config'
import { buildServices } from '../utils/compose'
import { pingAll } from '../utils/ping'
import { findProxyName } from '../utils/ping-core'
import { demoPings } from '../utils/demo'

// Reachability of each mapped domain. Polled on a slow cadence; results TTL-cached.
export default defineEventHandler(async (): Promise<PingMap> => {
  const cfg = getConfig()
  if (!cfg.pingEnabled) return {}
  if (cfg.demo) return demoPings()

  const { services, hosts } = await buildServices()
  const urls = [...new Set(services.flatMap((s) => s.domains.map((d) => d.url)))]
  // the reverse proxy container on homeport's own host: the fallback route when a
  // domain's public address can't be reached from inside Docker
  return await pingAll(urls, Date.now(), findProxyName(services, hosts?.[0]?.name))
})
