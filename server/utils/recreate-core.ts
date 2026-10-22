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
export function buildCreatePayload(
  inspect: any,
  image: string,
  overrides?: { env?: string[]; oldImageConfig?: Record<string, any> },
): CreatePlan {
  const name = String(inspect?.Name || '').replace(/^\//, '')
  if (!name) throw new Error('inspect data has no container name')

  const shortId = String(inspect?.Id || '').slice(0, 12)
  const cfg = overrides?.oldImageConfig
    ? stripImageDefaults(inspect?.Config || {}, overrides.oldImageConfig)
    : { ...(inspect?.Config || {}) }
  if (overrides?.env) cfg.Env = overrides.env

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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * A container's inspect Config mixes what the user set with what its IMAGE set
 * (ENV like PATH or PG_MAJOR, CMD, labels, exposed ports). Copied wholesale onto a
 * newer image, the old image's values would override the new one's: postgres 17
 * started with postgres 16's PATH. So everything still equal to the old image's
 * default is dropped and the new image supplies its own; values the user changed
 * are kept. (Watchtower does the same.)
 */
export function stripImageDefaults(config: Record<string, any>, imageConfig: Record<string, any>): Record<string, any> {
  const out = { ...config }
  const imageEnv = new Set<string>(imageConfig?.Env || [])
  if (Array.isArray(out.Env)) out.Env = out.Env.filter((e: string) => !imageEnv.has(e))
  if (out.Labels && imageConfig?.Labels) {
    out.Labels = Object.fromEntries(Object.entries(out.Labels).filter(([k, v]) => imageConfig.Labels[k] !== v))
  }
  for (const k of ['ExposedPorts', 'Volumes'] as const) {
    if (out[k] && imageConfig?.[k]) {
      out[k] = Object.fromEntries(Object.entries(out[k]).filter(([p]) => !(p in imageConfig[k])))
    }
  }
  for (const k of ['Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Healthcheck', 'StopSignal', 'Shell'] as const) {
    if (k in out && same(out[k], imageConfig?.[k])) delete out[k]
  }
  return out
}

/** Steps of an apply, for loud progress reporting. */
export interface ApplyStep {
  step: string
  ok: boolean
  detail?: string
}
