// Pure builder for recreating a container from its inspect data with a fresh image
// (watchtower-style update). No Docker imports — fixture-unit-tested.

export interface CreatePlan {
  name: string
  config: Record<string, any>
  /** Networks beyond the first — must be connected after create (API limit). */
  extraNetworks: Record<string, any>
}

/**
 * Map a full `docker inspect` payload onto a /containers/create payload that
 * preserves the container's configuration. The HostConfig is carried over as-is
 * (binds, ports, restart policy, resources…); network endpoints keep their
 * aliases minus the auto-generated short-id one.
 */
export function buildCreatePayload(inspect: any, image: string): CreatePlan {
  const name = String(inspect?.Name || '').replace(/^\//, '')
  if (!name) throw new Error('inspect data has no container name')

  const shortId = String(inspect?.Id || '').slice(0, 12)
  const cfg = { ...(inspect?.Config || {}) }

  const endpoints: Record<string, any> = {}
  const networks = inspect?.NetworkSettings?.Networks || {}
  for (const [net, ep] of Object.entries<any>(networks)) {
    const aliases = (ep?.Aliases || []).filter((a: string) => a !== shortId)
    endpoints[net] = {
      ...(aliases.length ? { Aliases: aliases } : {}),
      ...(ep?.IPAMConfig ? { IPAMConfig: ep.IPAMConfig } : {}),
    }
  }

  // The default hostname is the container's short id — recreating with the OLD
  // id as hostname would be wrong. Keep it only if the user pinned a custom one.
  if (cfg.Hostname === shortId) delete cfg.Hostname

  const config: Record<string, any> = {
    ...cfg,
    Image: image,
    HostConfig: inspect?.HostConfig || {},
  }

  const netNames = Object.keys(endpoints)
  const extraNetworks: Record<string, any> = {}
  if (netNames.length) {
    // /containers/create accepts ONE network in NetworkingConfig; the rest are
    // connected after create.
    config.NetworkingConfig = { EndpointsConfig: { [netNames[0]]: endpoints[netNames[0]] } }
    for (const n of netNames.slice(1)) extraNetworks[n] = endpoints[n]
  }

  return { name, config, extraNetworks }
}

/** Steps of an apply, for loud progress reporting. */
export interface ApplyStep {
  step: string
  ok: boolean
  detail?: string
}
