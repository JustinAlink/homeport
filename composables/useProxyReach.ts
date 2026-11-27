import type { Service } from '~/types/service'
import { PROXY_IMAGES, SOURCE_PROXY_IMAGES } from '~/shared/utils/proxy-sources'

// Can the reverse proxy reach a container? A proxy forwards to an app by
// container name only when both sit on a shared docker network (with name
// resolution, which Docker's default `bridge` doesn't have). The classic
// self-hosting 502 is a domain pointing at a container the proxy can't reach.
//
// The container that must reach the app follows where each domain was read
// (shared/utils/proxy-sources.ts): Traefik for a Traefik route, Newt for a
// Pangolin one. Unknown cases (no such container found, host networking) are
// reported as unknown, never as broken.

const NO_DNS = new Set(['bridge', 'host', 'none'])

/** Is this image a reverse proxy homeport knows? (Server-side twin: ping-core's PROXY_IMAGES.) */
export const isProxyImage = (image: string) => PROXY_IMAGES.includes(imageRepo(image))

export interface Reach {
  /** true: shares a network; false: can't reach by name; null: can't tell */
  ok: boolean | null
  proxy: Service | null
  shared: string[]
  /** the proxy network to connect the container to, when ok === false */
  suggest: string | null
}

export function useProxyReach() {
  const { data } = useServices()

  const proxy = computed<Service | null>(() => {
    const list = (data.value?.services ?? []).filter((s) => s.kind === 'container' && PROXY_IMAGES.includes(imageRepo(s.image)))
    return list.find((s) => s.state === 'running') ?? list[0] ?? null
  })

  // the container a source's domains depend on, or the general guess for unknown sources
  function proxyFor(source: string | undefined): Service | null {
    const images = source ? SOURCE_PROXY_IMAGES[source] : undefined
    if (!images) return proxy.value
    const list = (data.value?.services ?? []).filter((s) => s.kind === 'container' && images.includes(imageRepo(s.image)))
    return list.find((s) => s.state === 'running') ?? list[0] ?? null
  }

  function reach(target: Service | null | undefined, via: Service | null = proxy.value): Reach {
    const p = via
    if (!p || !target || target.id === p.id) return { ok: null, proxy: p, shared: [], suggest: null }
    if (p.networks?.includes('host') || target.networks?.includes('host')) return { ok: null, proxy: p, shared: [], suggest: null }
    const proxyNets = (p.networks ?? []).filter((n) => !NO_DNS.has(n))
    const targetNets = new Set((target.networks ?? []).filter((n) => !NO_DNS.has(n)))
    const shared = proxyNets.filter((n) => targetNets.has(n))
    // prefer a network made for sharing over the proxy stack's own private one
    const suggest = proxyNets.find((n) => !n.endsWith('_default')) ?? proxyNets[0] ?? null
    return { ok: shared.length > 0, proxy: p, shared, suggest }
  }

  /** Reach for a container that has domains routed to it by name (IP routes don't need a shared network). */
  function domainReach(target: Service): Reach {
    const byName = target.domains.filter((d) => d.via === 'name')
    if (!byName.length) return { ok: null, proxy: proxy.value, shared: [], suggest: null }
    // every container the domains depend on must reach it: the first that can't is the finding
    const results = [...new Set(byName.map((d) => d.source))].map((src) => reach(target, proxyFor(src)))
    return results.find((r) => r.ok === false) ?? results.find((r) => r.ok === true) ?? results[0]
  }

  return { proxy, reach, domainReach }
}
