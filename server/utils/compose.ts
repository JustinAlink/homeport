import type { Service, ServiceDomain, ServicesResponse, UnmatchedRoute } from '~/types/service'
import { listContainersFor, type RawContainer } from './docker'
import { getDomainProviderFor } from './providers'
import type { Route } from './providers/types'
import { getConfig } from './config'
import { demoServices } from './demo'
import { listSystemdServices, type SystemdUnit } from './systemd'
import { getHosts, isMultiHost, type HostConfig } from './hosts'

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)

function toService(host: HostConfig, c: RawContainer, domains: ServiceDomain[], multi: boolean): Service {
  const l = c.labels
  return {
    id: `${host.id}::${c.id}`,
    kind: 'container',
    host: multi ? host.name : undefined,
    name: c.name,
    displayName: l['hub.name'] || c.service || c.name,
    image: c.image,
    state: c.state,
    statusText: c.statusText,
    health: c.health,
    createdAt: c.createdAt,
    ports: c.ports,
    group: l['hub.group'] || c.project || 'Other',
    project: c.project,
    icon: l['hub.icon'] || null,
    domains,
    hidden: l['hub.hide'] === 'true',
    noalert: l['hub.noalert'] === 'true',
  }
}

function systemdToService(u: SystemdUnit): Service {
  const state =
    u.active === 'failed' ? 'failed'
      : u.active === 'activating' ? 'restarting'
        : u.active === 'active' && u.sub === 'running' ? 'running'
          : 'exited'
  return {
    id: `systemd::${u.unit}`,
    kind: 'systemd',
    name: u.unit,
    displayName: u.unit.replace(/\.service$/, ''),
    image: u.description || u.unit,
    state,
    statusText: `${u.active} · ${u.sub}`,
    health: null,
    createdAt: 0,
    ports: [],
    group: 'systemd',
    project: 'systemd',
    icon: null,
    domains: [],
    hidden: false,
    noalert: false,
  }
}

/** Build one host's services (containers joined with its reverse-proxy domains). */
async function buildHost(host: HostConfig, multi: boolean) {
  const provider = getDomainProviderFor(host)
  const [containers, routes] = await Promise.all([
    listContainersFor(host),
    provider ? provider.getRoutes() : Promise.resolve<Route[]>([]),
  ])

  const byName = new Map(containers.map((c) => [c.name, c]))
  const domainsById = new Map<string, ServiceDomain[]>()
  const usedRoutes = new Set<Route>()

  for (const route of routes) {
    let target: RawContainer | undefined
    if (isIp(route.upstreamHost)) {
      target = containers.find((c) => c.ports.some((p) => p.hostPort === route.upstreamPort))
    } else {
      target = byName.get(route.upstreamHost)
    }
    if (!target) continue
    const list = domainsById.get(target.id) || []
    for (const d of route.domains) list.push({ domain: d, url: `${route.ssl ? 'https' : 'http'}://${d}`, ssl: route.ssl })
    domainsById.set(target.id, list)
    usedRoutes.add(route)
  }

  const services = containers.map((c) => toService(host, c, domainsById.get(c.id) || [], multi))
  const unmatched: UnmatchedRoute[] = routes
    .filter((r) => !usedRoutes.has(r))
    .map((r) => ({ domains: r.domains, upstream: `${r.upstreamHost}:${r.upstreamPort}`, ssl: r.ssl }))

  return { services, unmatched, providerName: provider?.name ?? null }
}

/** Compose the dashboard payload across every configured host. */
export async function buildServices(): Promise<ServicesResponse> {
  const cfg = getConfig()
  if (cfg.demo) return demoServices()

  const hosts = getHosts()
  const multi = hosts.length > 1

  const perHost = await Promise.all(
    hosts.map(async (host) => {
      try {
        const r = await buildHost(host, multi)
        return { host, ...r, online: true, error: null as string | null }
      } catch (e: any) {
        return { host, services: [], unmatched: [], providerName: null, online: false, error: e?.message || String(e) }
      }
    }),
  )

  // systemd is about the machine homeport runs on — fetch once.
  let systemd: Service[] = []
  if (cfg.systemdEnabled) {
    try {
      systemd = (await listSystemdServices(cfg.systemdUnits)).map(systemdToService)
    } catch {
      systemd = []
    }
  }

  const services = [...perHost.flatMap((h) => h.services), ...systemd].sort(
    (a, b) => a.group.localeCompare(b.group) || a.displayName.localeCompare(b.displayName),
  )
  const unmatched = perHost.flatMap((h) => h.unmatched)
  const visible = services.filter((s) => !s.hidden)
  const providerNames = [...new Set(perHost.map((h) => h.providerName).filter(Boolean))] as string[]

  return {
    services,
    unmatched,
    stats: {
      running: visible.filter((s) => s.state === 'running').length,
      total: visible.length,
      groups: new Set(visible.map((s) => s.group)).size,
    },
    domainProvider: providerNames.length === 1 ? providerNames[0] : providerNames.length ? `${providerNames.length} providers` : null,
    controlEnabled: cfg.allowControl,
    remoteIcons: cfg.remoteIcons,
    hosts: perHost.map((h) => ({ id: h.host.id, name: h.host.name, online: h.online, error: h.error })),
    generatedAt: Date.now(),
  }
}

export { isMultiHost }
