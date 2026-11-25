import type { Route } from './types.ts'
import { parseTraefikLabels, TRAEFIK_LABELS_SOURCE } from './traefik.ts'
import { parseCaddyDockerProxyLabels, CADDY_DOCKER_PROXY_SOURCE, type LabelledContainer } from './caddy-docker-proxy.ts'
import { parsePangolinLabels, PANGOLIN_SOURCE } from './pangolin.ts'
import { imageRepoOf } from '../ping-core.ts'

// Which domain sources a host reads, and how they combine. Pure, unit-tested.
//
// Two kinds of source:
//  - a PRIMARY reader of the proxy's own config: NPM confs, a Caddyfile, Nginx
//    confs, a Traefik dynamic file, or the Traefik API. At most one per host,
//    picked exactly as before (explicit DOMAIN_PROVIDER, else the first configured
//    path), so an NPM host reads what it always read.
//  - LABEL sources, read from the container list homeport already has: Traefik
//    labels (the old fallback when nothing is configured), caddy-docker-proxy and
//    Pangolin. The last two only add routes when their proxy actually runs on the
//    host (detected by image or command), because a `caddy` or `pangolin.*` label
//    with nothing reading it routes nothing. They add to the primary instead of
//    replacing it: a host can serve some apps through NPM and others through a
//    Pangolin tunnel, and both are true.
// Choosing a label source explicitly reads it without the detection gate.

export type PrimaryId = 'npm' | 'caddy' | 'nginx' | 'traefik-api' | 'traefik-file'
export type LabelId = 'traefik' | 'caddy-docker-proxy' | 'pangolin'

/** Every value DOMAIN_PROVIDER / the settings select accepts ('' = auto-detect). */
export const DOMAIN_PROVIDER_IDS = ['', 'npm', 'nginx', 'caddy', 'traefik', 'traefik-file', 'traefik-api', 'caddy-docker-proxy', 'pangolin'] as const

export interface SourceHostConfig {
  domainProvider?: string | null
  npmConfDir?: string | null
  caddyfilePath?: string | null
  nginxConfDir?: string | null
  traefikFilePath?: string | null
  traefikApiUrl?: string | null
}

export interface SourcePlan {
  primary: PrimaryId | null
  /** label sources read regardless of what runs (an explicit choice, or the Traefik fallback) */
  labels: LabelId[]
  /** label sources read only when their proxy container is on the host */
  detect: LabelId[]
  /** the label sources in `labels` were chosen on purpose, so they are named even with no routes */
  explicitLabels: boolean
}

const DETECTABLE: LabelId[] = ['caddy-docker-proxy', 'pangolin']
const detectExcept = (id?: LabelId) => DETECTABLE.filter((x) => x !== id)

export function planSources(h: SourceHostConfig): SourcePlan {
  const primary = (id: PrimaryId, ready: unknown): SourcePlan => ({ primary: ready ? id : null, labels: [], detect: detectExcept(), explicitLabels: false })
  const labels = (id: LabelId): SourcePlan => ({ primary: null, labels: [id], detect: detectExcept(id), explicitLabels: true })

  switch ((h.domainProvider || '').toLowerCase()) {
    case 'npm':
      return primary('npm', h.npmConfDir)
    case 'caddy':
      return primary('caddy', h.caddyfilePath)
    case 'nginx':
      return primary('nginx', h.nginxConfDir)
    case 'traefik-file':
    case 'traefikfile':
      return primary('traefik-file', h.traefikFilePath)
    case 'traefik-api':
      return primary('traefik-api', h.traefikApiUrl)
    case 'traefik':
      return labels('traefik')
    case 'caddy-docker-proxy':
      return labels('caddy-docker-proxy')
    case 'pangolin':
      return labels('pangolin')
  }

  // auto: the configured paths in their old order. The Traefik API comes before the
  // Traefik file because it already includes the file provider's routes.
  if (h.npmConfDir) return primary('npm', true)
  if (h.caddyfilePath) return primary('caddy', true)
  if (h.nginxConfDir) return primary('nginx', true)
  if (h.traefikApiUrl) return primary('traefik-api', true)
  if (h.traefikFilePath) return primary('traefik-file', true)
  // nothing configured: Traefik labels, as before (not named unless they hold routes)
  return { primary: null, labels: ['traefik'], detect: detectExcept(), explicitLabels: false }
}

export interface ProxyCandidate {
  image: string
  command?: string
}

/**
 * Label proxies running on a host. caddy-docker-proxy: its image, or any image
 * whose command is `caddy docker-proxy` (custom builds with DNS plugins). Pangolin:
 * a site connector that reads labels, Newt or the pangolin CLI (`pangolin up site`).
 * Any container state counts: a stopped proxy still owns those domains, and the
 * domain check then shows them down instead of them silently vanishing.
 */
export function detectLabelProxies(containers: ProxyCandidate[]): Set<LabelId> {
  const found = new Set<LabelId>()
  for (const c of containers) {
    const repo = imageRepoOf(c.image || '')
    const cmd = (c.command || '').toLowerCase()
    if (/(^|\/)caddy-docker-proxy$/.test(repo) || /\bcaddy\b.*\bdocker-proxy\b/.test(cmd)) found.add('caddy-docker-proxy')
    if (/^fosrl\/(newt|pangolin-cli)$/.test(repo) || /(^|[\s/])newt(\s|$)/.test(cmd) || /\bpangolin\b.*\bup\b.*\bsite\b/.test(cmd)) found.add('pangolin')
  }
  return found
}

const LABEL_SOURCES: Record<LabelId, { name: string; parse: (c: LabelledContainer[]) => Route[] }> = {
  traefik: { name: TRAEFIK_LABELS_SOURCE, parse: parseTraefikLabels },
  'caddy-docker-proxy': { name: CADDY_DOCKER_PROXY_SOURCE, parse: (c) => parseCaddyDockerProxyLabels(c) },
  pangolin: { name: PANGOLIN_SOURCE, parse: parsePangolinLabels },
}

export const labelSourceName = (id: LabelId) => LABEL_SOURCES[id].name

export interface SourceResult {
  name: string
  routes: Route[]
  /** named in "domains via ..." even with no routes (configured on purpose) */
  configured: boolean
}

/** Routes from the label sources the plan reads on this container list. */
export function readLabelSources(plan: SourcePlan, containers: (LabelledContainer & ProxyCandidate)[]): SourceResult[] {
  const running = detectLabelProxies(containers)
  const ids = [...plan.labels, ...plan.detect.filter((id) => running.has(id))]
  return ids.map((id) => ({
    name: LABEL_SOURCES[id].name,
    routes: LABEL_SOURCES[id].parse(containers),
    configured: plan.labels.includes(id) && plan.explicitLabels,
  }))
}

/** "Nginx Proxy Manager", "Nginx Proxy Manager + Pangolin", or null when nothing is in use. */
export function sourcesLabel(results: SourceResult[]): string | null {
  const names = results.filter((r) => r.configured || r.routes.length > 0).map((r) => r.name)
  return names.length ? [...new Set(names)].join(' + ') : null
}
