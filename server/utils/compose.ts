import type { Service, ServiceDomain, ServicesResponse, UnmatchedRoute } from '~/types/service'
import { listContainers, type RawContainer } from './docker'
import { getDomainProvider } from './providers'
import type { Route } from './providers/types'
import { getConfig } from './config'
import { demoServices } from './demo'
import { listSystemdServices, type SystemdUnit } from './systemd'

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)

function toService(c: RawContainer, domains: ServiceDomain[]): Service {
  const l = c.labels
  return {
    id: c.id,
    kind: 'container',
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
  }
}

function systemdToService(u: SystemdUnit): Service {
  const state =
    u.active === 'failed'
      ? 'failed'
      : u.active === 'activating'
        ? 'restarting'
        : u.active === 'active' && u.sub === 'running'
          ? 'running'
          : 'exited'
  return {
    id: `systemd:${u.unit}`,
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
  }
}

/** Compose the full dashboard payload: containers joined with reverse-proxy domains. */
export async function buildServices(): Promise<ServicesResponse> {
  const cfg = getConfig()
  if (cfg.demo) return demoServices()

  const provider = getDomainProvider()
  const [containers, routes, systemd] = await Promise.all([
    listContainers(),
    provider ? provider.getRoutes() : Promise.resolve<Route[]>([]),
    cfg.systemdEnabled ? listSystemdServices(cfg.systemdUnits) : Promise.resolve<SystemdUnit[]>([]),
  ])

  const byName = new Map(containers.map((c) => [c.name, c]))
  const domainsById = new Map<string, ServiceDomain[]>()
  const usedRoutes = new Set<Route>()

  for (const route of routes) {
    let target: RawContainer | undefined
    if (isIp(route.upstreamHost)) {
      // Host-IP upstream (docker0 gateway) → match the container publishing that host port.
      target = containers.find((c) => c.ports.some((p) => p.hostPort === route.upstreamPort))
    } else {
      target = byName.get(route.upstreamHost)
    }
    if (!target) continue

    const list = domainsById.get(target.id) || []
    for (const d of route.domains) {
      list.push({ domain: d, url: `${route.ssl ? 'https' : 'http'}://${d}`, ssl: route.ssl })
    }
    domainsById.set(target.id, list)
    usedRoutes.add(route)
  }

  const services = [
    ...containers.map((c) => toService(c, domainsById.get(c.id) || [])),
    ...systemd.map(systemdToService),
  ].sort((a, b) => a.group.localeCompare(b.group) || a.displayName.localeCompare(b.displayName))

  const unmatched: UnmatchedRoute[] = routes
    .filter((r) => !usedRoutes.has(r))
    .map((r) => ({ domains: r.domains, upstream: `${r.upstreamHost}:${r.upstreamPort}`, ssl: r.ssl }))

  const visible = services.filter((s) => !s.hidden)
  return {
    services,
    unmatched,
    stats: {
      running: visible.filter((s) => s.state === 'running').length,
      total: visible.length,
      groups: new Set(visible.map((s) => s.group)).size,
    },
    domainProvider: provider?.name ?? null,
    controlEnabled: getConfig().allowControl,
    generatedAt: Date.now(),
  }
}
