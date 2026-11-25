import type { Service } from '~/types/service'
import { getLatestSnapshot } from './collector'
import { buildServices } from './compose'
import { containerKey, isContainerKey } from './history'

// Which history series an API caller means. Callers name a container by its
// service id (what every page has); the series is keyed by host and name so it
// outlives the id. A caller that already has the key (a status page, a script)
// may pass it as is.

/** The container a service id names: from the collector's snapshot, else a fresh listing. */
export async function findService(id: string): Promise<Service | null> {
  const fromSnap = getLatestSnapshot()?.services.find((s) => s.id === id)
  if (fromSnap) return fromSnap
  // no snapshot yet (boot), demo mode (no collector), or a container started since the tick
  return (await buildServices()).services.find((s) => s.id === id) ?? null
}

/** "host", "host-system", a container key, or the key of the container a service id names. */
export async function seriesKeyFor(id: string): Promise<string | null> {
  if (id === 'host' || id === 'host-system') return id
  if (id.includes('|')) return isContainerKey(id) ? id : null
  const s = await findService(id)
  return s && s.kind === 'container' ? containerKey(s) : null
}
