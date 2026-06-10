import type { PingMap } from '~/types/service'
import { getConfig } from '../utils/config'
import { buildServices } from '../utils/compose'
import { pingAll } from '../utils/ping'
import { demoPings } from '../utils/demo'

// Reachability of each mapped domain. Polled on a slow cadence; results TTL-cached.
export default defineEventHandler(async (): Promise<PingMap> => {
  const cfg = getConfig()
  if (!cfg.pingEnabled) return {}
  if (cfg.demo) return demoPings()

  const { services } = await buildServices()
  const urls = [...new Set(services.flatMap((s) => s.domains.map((d) => d.url)))]
  return await pingAll(urls, Date.now())
})
