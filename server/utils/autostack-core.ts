// Pure auto-dockerize logic — turn a registry image config or a repo's
// Dockerfile into a runnable compose file. No fs/network — unit-testable.

import { stringifyYAML } from 'confbox/yaml'

/** Docker Hub v4 search counts arrive as strings: "1B+" / "500M+" / "10K+" / "1234". */
export function parseHubCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const m = /^(\d+(?:\.\d+)?)\s*([KMB])?\+?$/i.exec(String(v ?? '').trim())
  if (!m) return 0
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(Number(m[1]) * mult)
}

/** Last path segment of an image ref as a safe compose service/stack name. */
export function serviceNameFromImage(image: string): string {
  const last = image.split('/').pop()?.split(/[:@]/)[0] || ''
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 63) || 'app'
  )
}

export interface ImageMeta {
  /** tcp ports the image EXPOSEs. */
  ports: number[]
  /** container paths the image declares as volumes. */
  volumes: string[]
}

/** ExposedPorts/Volumes out of a registry image config blob. */
export function imageMetaFromConfig(cfg: unknown): ImageMeta {
  const c = (((cfg ?? {}) as Record<string, unknown>).config ?? {}) as Record<string, unknown>
  const ports = Object.keys((c.ExposedPorts as object) ?? {})
    .map((k) => /^(\d+)\/tcp$/i.exec(k)?.[1])
    .filter((p): p is string => !!p)
    .map(Number)
    .filter((n) => n >= 1 && n <= 65535)
  const volumes = Object.keys((c.Volumes as object) ?? {}).filter((p) => p.startsWith('/'))
  return { ports: [...new Set(ports)].sort((a, b) => a - b), volumes: [...new Set(volumes)] }
}

/**
 * From an OCI image index / Docker manifest list, the digest of the variant to
 * inspect: linux/amd64 when present, else the first linux entry. Entries with
 * architecture "unknown" are attestation manifests, not images — skipped.
 */
export function pickManifestDigest(index: unknown): string | null {
  const list = ((index ?? {}) as Record<string, unknown>).manifests
  if (!Array.isArray(list)) return null
  const usable = list.filter(
    (m: any) => m?.digest && m?.platform?.os === 'linux' && m?.platform?.architecture !== 'unknown',
  )
  const amd = usable.find((m: any) => m.platform.architecture === 'amd64')
  return ((amd ?? usable[0]) as any)?.digest ?? null
}

export interface PortMapping {
  container: number
  host: number
}

const validPort = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535

/** A named compose volume key for a container path ("/config" → "<name>-config"). */
function volumeKey(name: string, containerPath: string, idx: number): string {
  const base = containerPath
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name}-${base || `vol${idx}`}`.slice(0, 63)
}

/**
 * Compose for a plain image pulled from a registry: the image's declared
 * volumes become named volumes (data survives recreates), port mappings come
 * from the caller (defaults are the image's EXPOSE list, host == container).
 */
export function composeFromImage(image: string, opts: { ports: PortMapping[]; volumes: string[] }): string {
  const name = serviceNameFromImage(image)
  const service: Record<string, unknown> = { image, restart: 'unless-stopped' }

  const ports = opts.ports.filter((p) => validPort(p?.container) && validPort(p?.host))
  if (ports.length) service.ports = ports.map((p) => `${p.host}:${p.container}`)

  const named: string[] = []
  const binds: string[] = []
  opts.volumes
    .filter((v) => typeof v === 'string' && v.startsWith('/') && !/[\s:'"]/.test(v))
    .forEach((v, i) => {
      const key = volumeKey(name, v, i)
      named.push(key)
      binds.push(`${key}:${v}`)
    })
  if (binds.length) service.volumes = binds

  const doc: Record<string, unknown> = { services: { [name]: service } }
  if (named.length) doc.volumes = Object.fromEntries(named.map((k) => [k, null]))
  return stringifyYAML(doc)
}

/** EXPOSE'd tcp ports from a Dockerfile (udp entries and ${ARG} forms ignored). */
export function dockerfilePorts(text: string): number[] {
  const out = new Set<number>()
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*EXPOSE\s+(.+)$/i.exec(line)
    if (!m) continue
    for (const tok of m[1].replace(/#.*$/, '').split(/\s+/)) {
      const pm = /^(\d+)(?:\/(tcp|udp))?$/i.exec(tok)
      if (!pm || (pm[2] ?? 'tcp').toLowerCase() !== 'tcp') continue
      const n = Number(pm[1])
      if (n >= 1 && n <= 65535) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Compose for a repo that ships only a Dockerfile: build in place. */
export function composeForBuild(name: string, ports: number[]): string {
  const service: Record<string, unknown> = { build: '.', restart: 'unless-stopped' }
  const valid = [...new Set(ports.filter(validPort))]
  if (valid.length) service.ports = valid.map((p) => `${p}:${p}`)
  return stringifyYAML({ services: { [serviceNameFromImage(name)]: service } })
}
