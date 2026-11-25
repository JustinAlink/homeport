import { getConfig, getEnvLocks } from '../../utils/config'
import { getHosts, type HostConfig } from '../../utils/hosts'
import { readSettings } from '../../utils/settings'
import { listContainersFor } from '../../utils/docker'
import { readHostSources } from '../../utils/providers'
import { DOMAIN_PROVIDER_IDS } from '../../utils/providers/sources-core'
import { keptPassword } from '../../utils/host-secrets-core'

// Test the domain sources: how many routes each one reads, with a few samples.
// The settings page sends its on-screen proxy fields, so a Traefik API URL or
// password can be tried before saving. Nothing is written. Overrides apply only to
// the single-host form (a multi-host list is tested as saved), never to a field the
// environment locks, and a blank password is the stored one only for the same server.

const FIELDS = ['domainProvider', 'npmConfDir', 'caddyfilePath', 'nginxConfDir', 'traefikFilePath', 'traefikApiUrl', 'traefikApiUser'] as const

function withOverrides(host: HostConfig, body: Record<string, unknown>): HostConfig {
  const locks = getEnvLocks() as Record<string, boolean>
  const next: HostConfig = { ...host }
  for (const f of FIELDS) {
    const v = body[f]
    if (typeof v !== 'string' || locks[f]) continue
    next[f] = v.trim()
  }
  if (next.domainProvider && !(DOMAIN_PROVIDER_IDS as readonly string[]).includes(next.domainProvider))
    throw createError({ statusCode: 400, statusMessage: 'invalid domainProvider' })
  if (next.traefikApiUrl && !/^https?:\/\//.test(next.traefikApiUrl))
    throw createError({ statusCode: 400, statusMessage: 'traefikApiUrl must be http(s)://' })
  if (!locks.traefikApiPassword) {
    const typed = typeof body.traefikApiPassword === 'string' ? body.traefikApiPassword : ''
    next.traefikApiPassword = keptPassword(typed, host.traefikApiPassword, next.traefikApiUrl, host.traefikApiUrl)
  }
  return next
}

export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (cfg.demo) {
    return { ok: true, provider: 'Demo', count: 9, samples: ['jellyfin.example.com → jellyfin', 'blog.example.com → ghost'], message: 'Demo: 9 route(s) · jellyfin.example.com → jellyfin, blog.example.com → ghost' }
  }

  let body: Record<string, unknown> = {}
  try {
    const b = await readBody(event)
    if (b && typeof b === 'object') body = b as Record<string, unknown>
  } catch {
    // no body: test what is saved
  }

  const s = readSettings()
  const single = !process.env.HOMEPORT_HOSTS && !s.hosts?.length
  const host = single ? withOverrides(getHosts()[0], body) : getHosts()[0]

  let sources
  try {
    sources = await readHostSources(host, listContainersFor(host))
  } catch (e: any) {
    return { ok: false, provider: null, message: `Could not list containers: ${e?.message || e}` }
  }

  const used = sources.filter((x) => x.configured || x.routes.length || x.error)
  if (!used.length) return { ok: false, provider: null, message: 'No domain source found: choose a provider, or label your containers.' }

  const sample = (r: { domains: string[]; upstreamHost: string; upstreamPort: number }) => `${r.domains[0]} → ${r.upstreamHost}${r.upstreamPort ? `:${r.upstreamPort}` : ''}`
  const message = used
    .map((x) => (x.error ? `${x.name}: ${x.error}` : `${x.name}: ${x.routes.length} route(s)${x.routes.length ? ' · ' + x.routes.slice(0, 2).map(sample).join(', ') : ''}`))
    .join(' | ')
  const routes = used.flatMap((x) => x.routes)
  return {
    ok: !used.some((x) => x.error),
    provider: used.map((x) => x.name).join(' + '),
    count: routes.length,
    samples: routes.slice(0, 3).map(sample),
    sources: used.map((x) => ({ name: x.name, count: x.routes.length, error: x.error ?? null })),
    message,
  }
})
