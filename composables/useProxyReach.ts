import type { Service } from '~/types/service'

// Can the reverse proxy reach a container? A proxy forwards to an app by
// container name only when both sit on a shared docker network (with name
// resolution, which Docker's default `bridge` doesn't have). The classic
// self-hosting 502 is a domain pointing at a container the proxy can't reach.
//
// The proxy is found by image among the running containers. Unknown cases (no
// proxy container found, proxy on the host network) are reported as unknown,
// never as broken.

const PROXY_IMAGES = [
  'jc21/nginx-proxy-manager',
  'traefik',
  'caddy',
  'lucaslorentz/caddy-docker-proxy',
  'nginxproxy/nginx-proxy',
  'jwilder/nginx-proxy',
]
const NO_DNS = new Set(['bridge', 'host', 'none'])

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

  function reach(target: Service | null | undefined): Reach {
    const p = proxy.value
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
    if (!target.domains.some((d) => d.via === 'name')) return { ok: null, proxy: proxy.value, shared: [], suggest: null }
    return reach(target)
  }

  return { proxy, reach, domainReach }
}
