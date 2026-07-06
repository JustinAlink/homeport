import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { listNetworksFor } from '../utils/networks'
import { demoNetworks } from '../utils/demo'

// Docker networks on the primary host with subnets + how many containers
// reference each — the data behind the stack pages' network-conflict card.
// Read-tier (names/subnets only), but needs NETWORKS=1 on a socket proxy.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return { networks: demoNetworks() }
  try {
    return { networks: await listNetworksFor(getHosts()[0]) }
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `could not list networks: ${e?.message || e} (a socket proxy needs NETWORKS=1)`,
    })
  }
})
