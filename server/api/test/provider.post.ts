import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { getDomainProviderFor } from '../../utils/providers'

// Test the reverse-proxy provider: how many routes it reads, with a few samples.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) {
    return { ok: true, provider: 'Demo', count: 9, samples: ['jellyfin.example.com → jellyfin', 'blog.example.com → ghost'] }
  }

  const host = getHosts()[0]
  const provider = getDomainProviderFor(host)
  if (!provider) return { ok: false, provider: null, message: 'No reverse proxy configured.' }

  try {
    const routes = await provider.getRoutes()
    return {
      ok: true,
      provider: provider.name,
      count: routes.length,
      samples: routes.slice(0, 3).map((r) => `${r.domains[0]} → ${r.upstreamHost}:${r.upstreamPort}`),
    }
  } catch (e: any) {
    return { ok: false, provider: provider.name, message: e?.message || 'failed to read routes' }
  }
})
