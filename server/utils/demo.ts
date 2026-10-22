import type { PingMap, Service, ServicesResponse, StatsMap, StatsResponse } from '~/types/service'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { startOp } from './ops'
import { safeNetworkName, parseCidr, findSubnetConflicts, type NetworkInfo } from './networks-core'
import { safeRelPath, type FileEntry } from './files-core'
import { tagKindOf, withTag } from './versions-core'

// A synthetic fleet for HOMEPORT_DEMO=true — lets people try homeport (and grab
// screenshots) without wiring up Docker. Generic example.com data only.

const DAY = 24 * 60 * 60 * 1000

interface Seed {
  name: string
  image: string
  group: string
  state?: string
  health?: Service['health']
  statusText: string
  domains?: { domain: string; ssl?: boolean }[]
  ports?: number[]
}

const seeds: Seed[] = [
  // media
  { name: 'jellyfin', image: 'jellyfin/jellyfin:10.9.6', group: 'media', statusText: 'Up 5 days', domains: [{ domain: 'jellyfin.example.com', ssl: true }], ports: [8096] },
  { name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:4.0.9', group: 'media', statusText: 'Up 5 days', domains: [{ domain: 'sonarr.example.com', ssl: true }], ports: [8989] },
  { name: 'radarr', image: 'lscr.io/linuxserver/radarr:5.11.0', group: 'media', statusText: 'Up 5 days', domains: [{ domain: 'radarr.example.com', ssl: true }], ports: [7878] },
  // web
  { name: 'ghost', image: 'ghost:5-alpine', group: 'web', statusText: 'Up 2 weeks', domains: [{ domain: 'blog.example.com', ssl: true }], ports: [2368] },
  { name: 'umami', image: 'ghcr.io/umami-software/umami:postgresql-latest', group: 'web', statusText: 'Up 2 weeks', domains: [{ domain: 'analytics.example.com', ssl: true }] },
  { name: 'umami-db', image: 'postgres:16-alpine', group: 'web', health: 'healthy', statusText: 'Up 2 weeks (healthy)', ports: [5432] },
  // infra
  { name: 'traefik', image: 'traefik:v3.1', group: 'infra', statusText: 'Up 3 weeks', ports: [80, 443, 8080] },
  { name: 'portainer', image: 'portainer/portainer-ce:2.21.0', group: 'infra', statusText: 'Up 3 weeks', domains: [{ domain: 'portainer.example.com', ssl: true }], ports: [9443] },
  { name: 'vaultwarden', image: 'vaultwarden/server:1.32.0', group: 'infra', health: 'healthy', statusText: 'Up 3 weeks (healthy)', domains: [{ domain: 'vault.example.com', ssl: true }] },
  // downloads
  { name: 'qbittorrent', image: 'lscr.io/linuxserver/qbittorrent:5.0.0', group: 'downloads', statusText: 'Up 6 days', domains: [{ domain: 'qbit.example.com', ssl: true }], ports: [8090] },
  { name: 'gluetun', image: 'qmcgaw/gluetun:v3.39.0', group: 'downloads', health: 'healthy', statusText: 'Up 6 days (healthy)' },
  { name: 'watchtower', image: 'containrrr/watchtower:1.7.1', group: 'downloads', state: 'restarting', statusText: 'Restarting (1) 4 seconds ago' },
  // backups
  { name: 'restic-backup', image: 'mazzolino/restic:1.6.0', group: 'backups', state: 'exited', statusText: 'Exited (0) 2 hours ago' },
  // an "unmanaged" compose project: runs on the host, but no stack dir in /stacks
  { name: 'legacy-app', image: 'legacy/app:1.0', group: 'legacy-app', statusText: 'Up 3 months', ports: [9000] },
  // started with plain `docker run`: no compose project (group '' = standalone)
  { name: 'speedtest', image: 'openspeedtest/latest', group: '', statusText: 'Up 9 days', ports: [3000] },
]

// Compose projects without a stack dir — shown read-only on the stacks pages.
const UNMANAGED_GROUPS = new Set(['legacy-app'])

// In-memory overrides so demo start/stop/restart actually toggle a card's state.
const demoOverrides: Record<string, 'running' | 'exited'> = {}
const demoRemoved = new Set<string>()
export function demoControl(id: string, action: 'start' | 'stop' | 'restart' | 'remove') {
  if (action === 'remove') {
    demoRemoved.add(id)
    return
  }
  demoOverrides[id] = action === 'stop' ? 'exited' : 'running'
}

function toService(s: Seed, i: number): Service {
  const id = `demo-${i}`
  const override = demoOverrides[id]
  const state = override || s.state || 'running'
  const statusText =
    override === 'running' ? 'Up a few seconds' : override === 'exited' ? 'Exited (0) just now' : s.statusText
  return {
    id,
    kind: 'container',
    name: s.name,
    displayName: s.name,
    image: s.image,
    state,
    statusText,
    health: s.health ?? null,
    createdAt: Date.now() - (i + 1) * DAY,
    ports: (s.ports || []).map((p) => ({ hostPort: p, containerPort: p, type: 'tcp' })),
    internalPorts: (s.ports || []).slice(),
    // from the demo network table, so connect/disconnect show up on the container too
    networks: demoNetworks().filter((n) => n.attached?.some((c) => c.id === `demo-${i}`)).map((n) => n.name),
    group: s.group || 'Other',
    project: s.group || null,
    composeService: s.group ? s.name : null,
    icon: null,
    domains: (s.domains || []).map((d) => ({
      domain: d.domain,
      url: `${d.ssl ? 'https' : 'http'}://${d.domain}`,
      ssl: !!d.ssl,
      via: 'name' as const, // demo routes point at container names, like most real proxy setups
    })),
    hidden: false,
    noalert: false,
  }
}

export function demoStats(): StatsResponse {
  const t = Date.now() / 4000 // gentle oscillation so demo sparklines move
  const containers: StatsMap = {}
  seeds.forEach((s, i) => {
    const state = demoOverrides[`demo-${i}`] || s.state || 'running'
    if (state !== 'running') return
    const base = ((i * 7) % 38) + 4
    const cpu = Math.max(0, Math.round((base + Math.sin(t + i) * 6) * 10) / 10)
    const memMiB = Math.max(20, 40 + ((i * 53) % 620) + Math.round(Math.sin(t * 0.7 + i) * 14))
    containers[`demo-${i}`] = {
      cpuPercent: cpu,
      memBytes: memMiB * 1024 * 1024,
      memLimitBytes: 1024 * 1024 * 1024,
      memPercent: Math.round((memMiB / 1024) * 1000) / 10,
    }
  })

  const vals = Object.values(containers)
  const ncpu = 4
  const memTotal = 8 * 1024 ** 3
  const cpuSum = vals.reduce((a, s) => a + (s.cpuPercent || 0), 0)
  const memUsed = vals.reduce((a, s) => a + s.memBytes, 0)
  return {
    containers,
    host: {
      ncpu,
      cpuPercent: Math.round((cpuSum / ncpu) * 10) / 10,
      memUsed,
      memTotal,
      memPercent: Math.round((memUsed / memTotal) * 1000) / 10,
      // demo "whole machine": containers + a wobbling ~14% of system overhead
      system: {
        cpuPercent: Math.round(((cpuSum / ncpu) + 6 + Math.sin(Date.now() / 60000) * 3) * 10) / 10,
        memUsed: Math.round(memUsed + memTotal * 0.14),
        memTotal,
        memPercent: Math.round(((memUsed + memTotal * 0.14) / memTotal) * 1000) / 10,
      },
    },
  }
}

/** Synthetic CPU/mem history so the graphs look alive in demo mode (no Docker). */
export function demoHistory(id: string, fromMs: number, toMs: number, res: number) {
  const isHost = id === 'host' || id === 'host-system'
  const sysBoost = id === 'host-system' ? 14 : 0
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
  const step = res * 1000
  const start = Math.floor(fromMs / step) * step
  const end = Math.floor(toMs / step) * step
  const t: number[] = []
  const cpu: (number | null)[] = []
  const mem: (number | null)[] = []
  for (let slot = start; slot <= end; slot += step) {
    const x = slot / 60000 // minutes
    t.push(slot)
    cpu.push(Math.max(0, Math.round((20 + sysBoost / 2 + Math.sin(x / 15 + h) * 12 + Math.sin(x / 3 + h) * 4) * 10) / 10))
    mem.push(
      isHost
        ? Math.max(5, Math.round((45 + sysBoost + Math.sin(x / 40 + h) * 15) * 10) / 10) // percent
        : Math.max(20, Math.round(120 + (h % 500) + Math.sin(x / 20 + h) * 40)), // MiB
    )
  }
  return { res, t, cpu, mem }
}

// Demo update statuses — jellyfin + vaultwarden start with updates available;
// "applying" flips them to current so the whole flow is clickable without Docker.
const demoUpdateState: Record<string, 'update' | 'current'> = {}
// What the registry's tag list would say about each demo image (versions-core).
const DEMO_VERSIONS: Record<string, { tagKind?: 'exact' | 'line' | 'floating'; newer?: { tag: string; bump: 'major' | 'minor' | 'patch' }; newerSameMajor?: { tag: string; bump: 'major' | 'minor' | 'patch' } }> = {
  'jellyfin/jellyfin:10.9.6': { tagKind: 'exact', newer: { tag: '10.10.3', bump: 'minor' } },
  'lscr.io/linuxserver/sonarr:4.0.9': { tagKind: 'exact', newer: { tag: '4.0.11', bump: 'patch' } },
  'lscr.io/linuxserver/radarr:5.11.0': { tagKind: 'exact' },
  'ghost:5-alpine': { tagKind: 'line', newer: { tag: '6-alpine', bump: 'major' } },
  'postgres:16-alpine': { tagKind: 'line', newer: { tag: '18-alpine', bump: 'major' } },
  'traefik:v3.1': { tagKind: 'line', newer: { tag: 'v3.5', bump: 'minor' } },
  'portainer/portainer-ce:2.21.0': { tagKind: 'exact', newer: { tag: '2.21.4', bump: 'patch' } },
  'vaultwarden/server:1.32.0': { tagKind: 'exact', newer: { tag: '1.32.5', bump: 'patch' } },
  'qmcgaw/gluetun:v3.39.0': { tagKind: 'exact', newer: { tag: 'v3.40.0', bump: 'minor' } },
}

export function demoUpdates(): Record<string, any> {
  const out: Record<string, any> = {}
  seeds.forEach((s, i) => {
    const key = `default|${s.image}`
    const seeded = i === 0 || i === 8 || UNMANAGED_GROUPS.has(s.group) ? 'update' : 'current'
    const status = demoUpdateState[key] ?? seeded
    const tag = s.image.includes(':') ? s.image.slice(s.image.lastIndexOf(':') + 1) : 'latest'
    out[key] = {
      status,
      localDigest: `sha256:${'ab'.repeat(8)}${i}`,
      remoteDigest: status === 'update' ? `sha256:${'cd'.repeat(8)}${i}` : `sha256:${'ab'.repeat(8)}${i}`,
      checkedAt: Date.now() - 3600_000,
      ...(DEMO_VERSIONS[s.image] ?? { tagKind: tagKindOf(tag) }),
    }
  })
  return out
}

/** A demo version switch: the container now runs the new tag (and is current). */
export function demoSwitchTag(name: string, tag: string) {
  const seed = seeds.find((s) => s.name === name)
  if (!seed) return
  seed.image = withTag(seed.image, tag)
  demoUpdateState[`default|${seed.image}`] = 'current'
}
export function demoApplyUpdate(image: string) {
  demoUpdateState[`default|${image}`] = 'current'
  return [
    { step: 'pull', ok: true, detail: image },
    { step: 'stop + rename old', ok: true },
    { step: 'create + start new', ok: true },
    { step: 'remove old', ok: true },
  ]
}

// ---- demo activity feed ----
export function demoActivity() {
  const now = Date.now()
  const H = 3600_000
  return [
    { id: 'default|jellyfin/jellyfin:10.9.6', name: 'jellyfin', host: 'demo', kind: 'update', from: 'jellyfin/jellyfin:10.9.6', to: 'sha256:cdcd', at: now - 0.4 * H },
    { id: 'auto|demo|stack media', name: 'stack media', host: 'demo', kind: 'updated', from: 'auto-update', to: '', at: now - 5 * H },
    { id: 'demo-12', name: 'restic-backup', kind: 'recovered', from: 'exited', to: 'running', at: now - 9 * H },
    { id: 'demo-12', name: 'restic-backup', kind: 'down', from: 'running', to: 'exited', at: now - 11 * H },
    { id: 'demo-5', name: 'umami-db', kind: 'unhealthy', from: 'healthy', to: 'unhealthy', at: now - 26 * H },
    { id: 'demo-5', name: 'umami-db', kind: 'recovered', from: 'unhealthy', to: 'healthy', at: now - 25.7 * H },
  ].sort((a, b) => b.at - a.at)
}

// ---- demo env editor ----
const demoEnvStore = new Map<string, { key: string; value: string | null; secret: boolean }[]>()
export function demoEnv(id: string) {
  if (!demoEnvStore.has(id)) {
    demoEnvStore.set(id, [
      { key: 'TZ', value: 'Europe/Amsterdam', secret: false },
      { key: 'PUID', value: '1000', secret: false },
      { key: 'PGID', value: '1000', secret: false },
      { key: 'DB_PASSWORD', value: null, secret: true },
    ])
  }
  return demoEnvStore.get(id)!
}
export function demoEnvApply(id: string, env: { key: string; value: string | null }[]) {
  const prev = new Map(demoEnv(id).map((e) => [e.key, e]))
  demoEnvStore.set(
    id,
    env.map(({ key, value }) => {
      const secret = /pass|secret|token|key/i.test(key)
      return { key, value: value === null ? (prev.get(key)?.value ?? null) : secret ? null : value, secret }
    }),
  )
  return [
    { step: 'inspect', ok: true },
    { step: 'stop + rename old', ok: true },
    { step: 'create + start new', ok: true },
    { step: 'remove old', ok: true },
  ]
}

// ---- demo proxy admin (in-memory route store seeded from demo domains) ----

import type { AdminRoute, NewRoute, ProxyAdmin } from './proxy-admin/types'

let demoRoutes: AdminRoute[] | null = null
function seedRoutes(): AdminRoute[] {
  if (demoRoutes) return demoRoutes
  demoRoutes = []
  seeds.forEach((s, i) => {
    for (const d of s.domains || []) {
      demoRoutes!.push({
        id: `npm-${i}`,
        domains: [d.domain],
        upstreamHost: s.name,
        upstreamPort: s.ports?.[0] ?? 80,
        ssl: !!d.ssl,
        managed: true,
      })
    }
  })
  return demoRoutes
}

export function demoProxyAdmin(): ProxyAdmin {
  return {
    name: 'Demo proxy',
    capabilities: { create: true, update: true, delete: true },
    async test() {
      return { ok: true, message: 'Demo proxy admin (no real proxy).' }
    },
    async listRoutes() {
      return [...seedRoutes()]
    },
    async createRoute(r: NewRoute) {
      const route: AdminRoute = { ...r, id: `hp-${seedRoutes().length + 1}`, managed: true }
      seedRoutes().push(route)
      return route
    },
    async updateRoute(id: string, r: NewRoute) {
      const list = seedRoutes()
      const idx = list.findIndex((x) => x.id === id)
      if (idx < 0) throw new Error('route not found')
      list[idx] = { ...r, id, managed: true }
      return list[idx]
    },
    async deleteRoute(id: string) {
      demoRoutes = seedRoutes().filter((x) => x.id !== id)
    },
  }
}

// ---- demo stacks (group seeds presented as compose stacks) ----

const demoStackContent = new Map<string, string>()

// Declared in a demo compose file but never started, so the dashboard and stack
// pages can show a "not running" service (what a real stack looks like after a
// failed start, or after `down`).
const DEMO_NOT_CREATED: Record<string, { name: string; image: string }[]> = {
  media: [{ name: 'bazarr', image: 'lscr.io/linuxserver/bazarr:1.4.5' }],
}

function synthCompose(group: string): string {
  const members = [
    ...seeds.filter((s) => s.group === group),
    ...(DEMO_NOT_CREATED[group] ?? []).map((d) => ({ ...d, group, statusText: '' }) as Seed),
  ]
  const svc = (s: Seed) =>
    [
      `  ${s.name}:`,
      `    image: ${s.image}`,
      `    restart: unless-stopped`,
      ...(s.ports?.length ? [`    ports:`, ...s.ports.map((p) => `      - "${p}:${p}"`)] : []),
    ].join('\n')
  return `services:\n${members.map(svc).join('\n')}\n`
}

// One demo stack presents as an external project managed in place (compose root).
const DEMO_EXTERNAL_STACK = 'downloads'

export function demoStackList() {
  const groups = [...new Set(seeds.map((s) => s.group))].filter((g) => g && !UNMANAGED_GROUPS.has(g))
  const stacks = groups.map((g) => {
    const members = seeds.map((s, i) => ({ s, i })).filter(({ s }) => s.group === g)
    const running = members.filter(({ s, i }) => (demoOverrides[`demo-${i}`] || s.state || 'running') === 'running').length
    const missing = (DEMO_NOT_CREATED[g] ?? []).map(({ name, image }) => ({ name, image }))
    const total = members.length + missing.length
    const external = g === DEMO_EXTERNAL_STACK
    return {
      name: g,
      state: running === 0 ? 'stopped' : running === total ? 'running' : 'partial',
      running,
      total,
      missing,
      file: 'compose.yaml',
      source: external ? 'adopted' : 'stacks',
      dir: external ? `/home/demo/docker/${g}` : undefined,
      git: g === 'media' || demoGitStacks.has(g),
    }
  })
  return {
    stacks,
    unmanaged: [{ name: 'legacy-app', running: 1, total: 1, workingDir: '/opt/legacy-app' }],
    dir: '/stacks',
    roots: [],
  }
}

export function demoStackRead(name: string) {
  if (UNMANAGED_GROUPS.has(name)) return null
  if (![...new Set(seeds.map((s) => s.group))].includes(name) && !demoStackContent.has(name)) return null
  const external = name === DEMO_EXTERNAL_STACK
  return {
    name,
    file: 'compose.yaml',
    content: demoStackContent.get(name) ?? synthCompose(name),
    source: external ? 'adopted' : 'stacks',
    dir: external ? `/home/demo/docker/${name}` : `/stacks/${name}`,
  }
}

export function demoStackSave(name: string, content: string, _create: boolean) {
  demoStackContent.set(name, content)
  return { ok: true, stack: { name, file: 'compose.yaml', content, source: 'stacks', dir: `/stacks/${name}` } }
}

// Representative "Data & mounts" rows so the discovery view is demoable: a bit of
// editable in-folder config, a named volume, and a read-only host bind. `container`
// is a fake service id the demo container-file editor accepts.
export function demoStackMounts(name: string) {
  const dir = `/stacks/${name}`
  if (name === 'media') {
    return {
      dir,
      mounts: [
        { kind: 'bind-internal', rel: 'config', dest: '/config', rw: true, services: ['jellyfin'], container: 'demo::jellyfin', hostVisible: true },
        // a bind whose host path homeport can't see → routes to the container editor
        { kind: 'bind-internal', rel: 'searxng', dest: '/etc/searxng', rw: true, services: ['jellyfin'], container: 'demo::jellyfin', hostVisible: false },
        { kind: 'volume', name: 'media_cache', anonymous: false, dest: '/cache', rw: true, services: ['jellyfin'], container: 'demo::jellyfin' },
        { kind: 'bind-external', source: '/mnt/media', dest: '/media', rw: false, services: ['jellyfin'], container: 'demo::jellyfin' },
      ],
    }
  }
  return {
    dir,
    mounts: [{ kind: 'volume', name: `${name}-data`, anonymous: false, dest: '/data', rw: true, services: [name], container: `demo::${name}` }],
  }
}

// A tiny fake in-container filesystem so the container file editor is demoable —
// this is exactly the searxng case: config that lives in a named volume, not the
// stack folder. Writes persist for the session so "save" round-trips.
const demoContainerFiles = new Map<string, string>([
  ['settings.yml', 'use_default_settings: true\nsearch:\n  safe_search: 0\n  autocomplete: "duckduckgo"\nserver:\n  secret_key: "change_me"\n  limiter: true\n'],
  ['uwsgi.ini', '[uwsgi]\nworkers = 4\nthreads = 4\n'],
  ['limiter.toml', '[botdetection.ip_limit]\nlink_token = true\n'],
])

export function demoContainerList(_id: string, root: string, rel: string) {
  if (rel) throw createError({ statusCode: 400, statusMessage: 'not a directory' })
  const entries = [...demoContainerFiles.entries()]
    .map(([name, content]) => ({ name, type: 'file' as const, size: content.length, mtime: Date.now() - 3600_000 }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { root, path: rel, abs: root, entries, truncated: false }
}

export function demoContainerRead(event: any, _id: string, _root: string, rel: string, download: boolean) {
  const content = demoContainerFiles.get(rel)
  if (content === undefined) throw createError({ statusCode: 404, statusMessage: 'no such file' })
  if (download) {
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'content-disposition', `attachment; filename="${rel.split('/').pop()}"`)
    return Buffer.from(content)
  }
  return { path: rel, content }
}

export function demoContainerWrite(_id: string, _root: string, rel: string, content: string) {
  if (!rel) throw createError({ statusCode: 400, statusMessage: 'invalid path' })
  demoContainerFiles.set(rel, content)
  return { ok: true, path: rel }
}

// One demo stack presents as git-backed so the from-git flow is demoable.
const DEMO_GIT_STACK = 'media'

export const demoIsGitStack = (name: string) => name === DEMO_GIT_STACK || demoGitStacks.has(name)

export function demoGitMeta(name: string) {
  if (name !== DEMO_GIT_STACK && !demoGitStacks.has(name)) return { git: false }
  return {
    git: true,
    repo: 'https://github.com/example/media-stack',
    branch: 'main',
    commit: 'a1b2c3d',
    subject: 'Tune jellyfin transcode settings',
    committedAt: '2026-07-01T12:00:00+02:00',
    behind: true,
    remoteCommit: 'e4f5a6b',
    tracked: ['compose.yaml', 'config/settings.yml'],
  }
}

const demoGitStacks = new Set<string>()

export function demoStackFromGit(name: string, repo: string, ref: string) {
  demoGitStacks.add(name)
  demoStackContent.set(name, synthCompose(name))
  const opId = startOp(`clone ${name}`, async (emit) => {
    const lines = [
      `$ git clone --depth 1 --branch ${ref} ${repo}`,
      `Cloning into '${name}'…`,
      'remote: Enumerating objects: 42, done.',
      'Receiving objects: 100% (42/42), done.',
      `$ docker compose -p ${name} up -d`,
      `✔ Container ${name}-app-1  Started`,
      '✓ done',
    ]
    for (const l of lines) {
      emit(l)
      await new Promise((r) => setTimeout(r, 400))
    }
    return true
  })
  return { ok: true, stack: name, opId }
}

export function demoCatalogInstall(
  app: { name: string; image: string },
  stackName: string,
  content: string,
): { ok: true; stack: string; opId: string } {
  demoStackContent.set(stackName, content)
  const opId = startOp(`install ${stackName}`, async (emit) => {
    const lines = [
      `$ docker compose -p ${stackName} up -d`,
      `Pulling ${app.image}…`,
      '✔ image pulled',
      `✔ Container ${stackName}-app-1  Created`,
      `✔ Container ${stackName}-app-1  Started`,
      '✓ done',
    ]
    for (const l of lines) {
      emit(l)
      await new Promise((r) => setTimeout(r, 450))
    }
    return true
  })
  return { ok: true, stack: stackName, opId }
}

// Canned catalog top-lists + image inspection so the Docker Hub / GitHub tabs
// (and their auto-dockerize flows) work fully offline in demo mode.
export function demoHubTop() {
  return {
    results: [
      { name: 'nginx', description: 'Official build of Nginx.', stars: 20500, pulls: 1e9, official: true },
      { name: 'postgres', description: 'The PostgreSQL object-relational database system.', stars: 14100, pulls: 1e9, official: true },
      { name: 'redis', description: 'The world’s fastest in-memory data store.', stars: 13300, pulls: 1e9, official: true },
      { name: 'jellyfin/jellyfin', description: 'The Free Software Media System.', stars: 1600, pulls: 1e8, official: false },
      { name: 'louislam/uptime-kuma', description: 'A fancy self-hosted monitoring tool.', stars: 1200, pulls: 1e8, official: false },
      { name: 'vaultwarden/server', description: 'Unofficial Bitwarden compatible server.', stars: 1100, pulls: 5e8, official: false },
      { name: 'gitea/gitea', description: 'Gitea: Git with a cup of tea.', stars: 900, pulls: 2e8, official: false },
      { name: 'nextcloud', description: 'A safe home for all your data.', stars: 4200, pulls: 5e8, official: true },
      { name: 'homeassistant/home-assistant', description: 'Open source home automation.', stars: 1900, pulls: 3e8, official: false },
    ],
  }
}

export function demoGithubTop() {
  return {
    results: [
      { name: 'immich-app/immich', description: 'High performance self-hosted photo and video management.', stars: 106000, url: 'https://github.com/immich-app/immich', cloneUrl: 'https://github.com/immich-app/immich.git' },
      { name: 'louislam/uptime-kuma', description: 'A fancy self-hosted monitoring tool.', stars: 88000, url: 'https://github.com/louislam/uptime-kuma', cloneUrl: 'https://github.com/louislam/uptime-kuma.git' },
      { name: 'n8n-io/n8n', description: 'Fair-code workflow automation platform.', stars: 195000, url: 'https://github.com/n8n-io/n8n', cloneUrl: 'https://github.com/n8n-io/n8n.git' },
      { name: 'open-webui/open-webui', description: 'User-friendly AI interface.', stars: 144000, url: 'https://github.com/open-webui/open-webui', cloneUrl: 'https://github.com/open-webui/open-webui.git' },
      { name: 'jellyfin/jellyfin', description: 'The Free Software Media System.', stars: 42000, url: 'https://github.com/jellyfin/jellyfin', cloneUrl: 'https://github.com/jellyfin/jellyfin.git' },
      { name: 'paperless-ngx/paperless-ngx', description: 'Scan, index and archive your physical documents.', stars: 31000, url: 'https://github.com/paperless-ngx/paperless-ngx', cloneUrl: 'https://github.com/paperless-ngx/paperless-ngx.git' },
    ],
  }
}

// Plausible per-image metadata keyed by service name; generic fallback.
const DEMO_IMAGE_META: Record<string, { ports: number[]; volumes: string[] }> = {
  jellyfin: { ports: [8096], volumes: ['/config', '/cache'] },
  nginx: { ports: [80], volumes: [] },
  postgres: { ports: [5432], volumes: ['/var/lib/postgresql/data'] },
  redis: { ports: [6379], volumes: ['/data'] },
  'uptime-kuma': { ports: [3001], volumes: ['/app/data'] },
  nextcloud: { ports: [80], volumes: ['/var/www/html'] },
}

export function demoHubInspect(image: string): { ports: number[]; volumes: string[] } {
  const name = image.split('/').pop()?.split(/[:@]/)[0]?.toLowerCase() || ''
  return DEMO_IMAGE_META[name] ?? { ports: [8080], volumes: ['/config'] }
}

// In-memory restart policies so the start-on-boot row round-trips in demo.
const demoPolicies: Record<string, string> = {}
export function demoRestartPolicy(id: string) {
  return { policy: demoPolicies[id] ?? 'unless-stopped', composeManaged: true }
}
export function demoSetRestartPolicy(id: string, policy: string) {
  demoPolicies[id] = policy
  return { ok: true, policy }
}

// In-memory CPU/memory limits so the resources editor round-trips in demo.
interface DemoResources {
  cpuShares: number
  cpuQuota: number
  cpuPeriod: number
  cpusetCpus: string
  memory: number
  memoryReservation: number
  memorySwap: number
}
const DEMO_RESOURCES_DEFAULT: DemoResources = {
  cpuShares: 0,
  cpuQuota: 0,
  cpuPeriod: 0,
  cpusetCpus: '',
  memory: 0,
  memoryReservation: 0,
  memorySwap: 0,
}
const demoResourcesById: Record<string, DemoResources> = {}
export function demoResources(id: string) {
  const r = demoResourcesById[id] ?? DEMO_RESOURCES_DEFAULT
  return { ...r, composeManaged: true }
}
export function demoSetResources(id: string, patch: Partial<DemoResources>) {
  const current = demoResourcesById[id] ?? { ...DEMO_RESOURCES_DEFAULT }
  demoResourcesById[id] = { ...current, ...patch }
  return { ok: true }
}

export function demoStackDelete(name: string, opts?: { volumes?: boolean; images?: boolean; proxyRoutes?: boolean }): string {
  return startOp(`delete ${name}`, async (emit) => {
    await new Promise((r) => setTimeout(r, 400))
    if (!demoStackContent.has(name)) {
      emit('demo: the built-in demo stacks cannot be deleted — create one first, then delete it')
      return false
    }
    const args = ['down', '--remove-orphans']
    if (opts?.volumes) args.push('--volumes')
    if (opts?.images) args.push('--rmi', 'all')
    emit(`$ docker compose -p ${name} ${args.join(' ')}`)
    await new Promise((r) => setTimeout(r, 500))
    if (opts?.volumes) emit(`✔ Volume ${name}_data  Removed`)
    if (opts?.images) emit(`✔ Image ${name}:latest  Removed`)
    emit(`removed leftover network ${name}_default (172.28.0.0/16)`)
    if (opts?.proxyRoutes) emit(`removed proxy route ${name}.example.com → ${name}:8080`)
    emit(`removed stack directory /stacks/${name}${opts?.volumes ? '' : ' (named volumes kept)'}`)
    demoStackContent.delete(name)
    return true
  })
}

export function demoStackAction(name: string, op: string): string {
  // run a scripted op through the real registry so SSE streaming is identical
  const lines =
    op === 'update'
      ? [`$ git fetch origin main`, 'From https://github.com/example/media-stack', '   a1b2c3d..e4f5a6b  main -> origin/main', '$ git reset --hard FETCH_HEAD', "HEAD is now at e4f5a6b Add hardware transcode profile", `$ docker compose -p ${name} up -d --build --remove-orphans`, `✔ Container ${name}-app-1  Started`, '✓ done']
      : op === 'pull'
      ? [`$ docker compose -p ${name} pull`, 'Pulling images…', '✔ images up to date', `$ docker compose -p ${name} up -d`, `✔ Container ${name}-app-1  Started`, '✓ done']
      : op === 'down'
        ? [`$ docker compose -p ${name} down`, `✔ Container ${name}-app-1  Removed`, '✓ done']
        : [`$ docker compose -p ${name} ${op} -d`, `✔ Container ${name}-app-1  Started`, '✓ done']
  return startOp(`${op} ${name}`, async (emit) => {
    for (const l of lines) {
      emit(l)
      await new Promise((r) => setTimeout(r, 450))
    }
    // flip demo container states for up/down so the dashboard reflects it
    seeds.forEach((s, i) => {
      if (s.group === name) demoOverrides[`demo-${i}`] = op === 'down' ? 'exited' : 'running'
    })
    // a pull/update deploys fresh images — clear the group's update badges
    if (op === 'pull' || op === 'update') {
      for (const s of seeds) if (s.group === name) demoUpdateState[`default|${s.image}`] = 'current'
    }
    return true
  })
}

// In-memory docker network list so the networks page + conflict card round-trip in demo.
const demoRemovedNetworks = new Set<string>()
const demoExtraNetworks: NetworkInfo[] = []
// network name → service id → attached ('on') / detached ('off') override
const demoNetOverrides = new Map<string, Map<string, 'on' | 'off'>>()
export function demoNetworks(): NetworkInfo[] {
  const groups = [...new Set(seeds.map((s) => s.group))].filter((g) => g && g !== 'systemd')
  const projectNets = groups.map((g, gi) => {
    const attached = seeds
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.group === g)
      .map(({ s, i }) => ({ id: `demo-${i}`, name: s.name }))
    return {
      id: `demo-net-${g}`,
      name: `${g}_default`,
      driver: 'bridge',
      builtin: false,
      subnets: [`172.${19 + gi}.0.0/16`],
      containers: attached.length,
      attached,
      project: g,
    }
  })
  // the shared network the reverse proxy (traefik) uses to reach apps by name; umami
  // is left off on purpose so the "proxy can't reach it" warning has a demo case (in a
  // stack that isn't git-backed, so saving the fix to the compose file is demoable)
  const proxyAttached = seeds
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.domains?.length || s.name === 'traefik') && s.name !== 'umami')
    .map(({ s, i }) => ({ id: `demo-${i}`, name: s.name }))
  const bridgeAttached = seeds
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.group)
    .map(({ s, i }) => ({ id: `demo-${i}`, name: s.name }))
  const nets: NetworkInfo[] = [
    { id: 'demo-net-bridge', name: 'bridge', driver: 'bridge', builtin: true, subnets: ['172.17.0.0/16'], containers: bridgeAttached.length, attached: bridgeAttached as { id: string; name: string }[], project: null as string | null },
    { id: 'demo-net-proxy', name: 'proxy', driver: 'bridge', builtin: false, subnets: ['192.168.0.0/20'], containers: proxyAttached.length, attached: proxyAttached, project: null },
    // an unused leftover — the removable kind that causes "Pool overlaps" on reinstalls
    { id: 'demo-net-old', name: 'oldapp_default', driver: 'bridge', builtin: false, subnets: ['172.18.0.0/16'], containers: 0, attached: [], project: 'oldapp' },
    ...projectNets,
    ...demoExtraNetworks,
  ]
  return nets
    .filter((n) => !demoRemovedNetworks.has(n.name))
    .map((n) => {
      const ov = demoNetOverrides.get(n.name)
      if (!ov?.size) return n
      let attached = (n.attached || []).filter((c) => ov.get(c.id) !== 'off')
      for (const [sid, mode] of ov) {
        if (mode === 'on' && !attached.some((c) => c.id === sid)) {
          const idx = Number(sid.replace('demo-', ''))
          attached = [...attached, { id: sid, name: seeds[idx]?.name || sid }]
        }
      }
      return { ...n, attached, containers: attached.length }
    })
}

export function demoNetworkCreate(name: string, subnet: string) {
  if (!safeNetworkName(name)) throw createError({ statusCode: 400, statusMessage: 'invalid network name (letters, digits, . _ -)' })
  if (demoNetworks().some((n) => n.name === name))
    throw createError({ statusCode: 400, statusMessage: `a network named "${name}" already exists` })
  if (subnet) {
    if (!parseCidr(subnet)) throw createError({ statusCode: 400, statusMessage: `"${subnet}" is not a valid CIDR subnet (e.g. 172.30.0.0/16)` })
    const clash = findSubnetConflicts([subnet], demoNetworks())[0]
    if (clash)
      throw createError({ statusCode: 400, statusMessage: `subnet ${subnet} overlaps existing network "${clash.network}" (${clash.subnet})` })
  }
  demoRemovedNetworks.delete(name)
  demoExtraNetworks.push({ id: `demo-net-x-${name}`, name, driver: 'bridge', builtin: false, subnets: subnet ? [subnet] : [], containers: 0, attached: [], project: null })
  return { ok: true }
}

export function demoNetworkConnect(network: string, id: string) {
  if (!demoNetworks().some((n) => n.name === network))
    throw createError({ statusCode: 400, statusMessage: `no network named "${network}"` })
  const ov = demoNetOverrides.get(network) ?? new Map()
  ov.set(id, 'on')
  demoNetOverrides.set(network, ov)
  return { ok: true }
}

export function demoNetworkDisconnect(network: string, id: string) {
  const memberships = demoNetworks().filter((n) => n.attached?.some((c) => c.id === id))
  if (!memberships.some((n) => n.name === network))
    throw createError({ statusCode: 400, statusMessage: `container is not attached to "${network}"` })
  if (memberships.length <= 1)
    throw createError({
      statusCode: 400,
      statusMessage: "that is the container's only network — attach it to another one first (a container with no network is unreachable)",
    })
  const ov = demoNetOverrides.get(network) ?? new Map()
  ov.set(id, 'off')
  demoNetOverrides.set(network, ov)
  return { ok: true }
}
export function demoNetworkRemove(name: string) {
  const net = demoNetworks().find((n) => n.name === name)
  if (!net) throw createError({ statusCode: 400, statusMessage: `no network named "${name}"` })
  if (net.builtin) throw createError({ statusCode: 400, statusMessage: `"${name}" is a built-in docker network` })
  if (net.containers > 0)
    throw createError({ statusCode: 400, statusMessage: `network "${name}" is still used by ${net.containers} containers` })
  demoRemovedNetworks.add(name)
  return { ok: true }
}

// --- demo storage: volumes + images incl. the orphaned-leftovers case ---
const demoRemovedVolumes = new Set<string>()
const demoRemovedImages = new Set<string>()
export function demoStorage() {
  const svcEntry = (i: number) => ({ id: `demo-${i}`, name: seeds[i].name })
  const volumes = [
    { name: 'media_config', driver: 'local', createdAt: Date.now() - 40 * DAY, project: 'media', attached: [svcEntry(0)] },
    { name: 'web_ghost-content', driver: 'local', createdAt: Date.now() - 90 * DAY, project: 'web', attached: [svcEntry(3)] },
    { name: 'infra_vaultwarden-data', driver: 'local', createdAt: Date.now() - 120 * DAY, project: 'infra', attached: [svcEntry(8)] },
    // the pelican case: a deleted stack's data volumes, orphaned but intact
    { name: 'pelican_pelican-data', driver: 'local', createdAt: Date.now() - 200 * DAY, project: 'pelican', attached: [] },
    { name: 'pelican_pelican-logs', driver: 'local', createdAt: Date.now() - 200 * DAY, project: 'pelican', attached: [] },
  ].filter((v) => !demoRemovedVolumes.has(v.name))
  const images = [
    { id: 'sha256:demo-jellyfin', ref: 'jellyfin/jellyfin:10.9.6', dangling: false, size: 780 * 1024 ** 2, createdAt: Date.now() - 30 * DAY, attached: [svcEntry(0)] },
    { id: 'sha256:demo-ghost', ref: 'ghost:5-alpine', dangling: false, size: 420 * 1024 ** 2, createdAt: Date.now() - 60 * DAY, attached: [svcEntry(3)] },
    // leftover image of the deleted stack + a dangling build layer
    { id: 'sha256:demo-pelican', ref: 'ghcr.io/pelican-dev/panel:latest', dangling: false, size: 812 * 1024 ** 2, createdAt: Date.now() - 20 * DAY, attached: [] },
    { id: 'sha256:demo-dangling', ref: '4be2a1c3d5e6', dangling: true, size: 96 * 1024 ** 2, createdAt: Date.now() - 15 * DAY, attached: [] },
  ].filter((i) => !demoRemovedImages.has(i.id))
  return { volumes, images }
}
export function demoVolumeSizes(): Record<string, number> {
  return {
    media_config: 320 * 1024 ** 2,
    'web_ghost-content': 1.4 * 1024 ** 3,
    'infra_vaultwarden-data': 48 * 1024 ** 2,
    'pelican_pelican-data': 1.2 * 1024 ** 3,
    'pelican_pelican-logs': 220 * 1024 ** 2,
  }
}
export function demoVolumeRemove(name: string) {
  const vol = demoStorage().volumes.find((v) => v.name === name)
  if (!vol) throw createError({ statusCode: 400, statusMessage: `no volume named "${name}"` })
  if (vol.attached.length)
    throw createError({ statusCode: 400, statusMessage: `volume "${name}" is still used by ${vol.attached.map((c) => c.name).join(', ')} — delete those containers first` })
  demoRemovedVolumes.add(name)
  return { ok: true }
}
export function demoImageRemove(id: string) {
  const img = demoStorage().images.find((i) => i.id === id)
  if (!img) throw createError({ statusCode: 400, statusMessage: 'no such image' })
  if (img.attached.length)
    throw createError({ statusCode: 400, statusMessage: `image is still used by ${img.attached.map((c) => c.name).join(', ')} — delete those containers first` })
  demoRemovedImages.add(id)
  return { ok: true }
}

// --- demo file browser: an in-memory tree per stack ---
type DemoNode = { type: 'dir' } | { type: 'file'; content: string }
const demoFileTrees = new Map<string, Map<string, DemoNode>>()
function demoTree(name: string): Map<string, DemoNode> | null {
  if (!demoFileTrees.has(name)) {
    if (!demoStackRead(name)) return null
    const t = new Map<string, DemoNode>()
    t.set('.env', { type: 'file', content: `# environment for ${name}\nTZ=Europe/Amsterdam\nAPI_KEY=change-me\n` })
    t.set('config', { type: 'dir' })
    t.set('config/settings.json', { type: 'file', content: '{\n  "example": true\n}\n' })
    demoFileTrees.set(name, t)
  }
  return demoFileTrees.get(name)!
}
// compose.yaml reads live from the stack store so the editor + browser agree
function demoNode(name: string, rel: string): DemoNode | null {
  if (rel === 'compose.yaml') {
    const s = demoStackRead(name)
    return s ? { type: 'file', content: s.content } : null
  }
  return demoTree(name)?.get(rel) ?? null
}

export function demoFileList(name: string, path: string) {
  const rel = safeRelPath(path)
  const tree = demoTree(name)
  if (rel === null || !tree) throw createError({ statusCode: 404, statusMessage: 'Unknown stack or path' })
  if (rel !== '' && tree.get(rel)?.type !== 'dir') throw createError({ statusCode: 400, statusMessage: 'not a directory' })
  const names = new Set<string>()
  const entries: FileEntry[] = []
  const all: [string, DemoNode][] = [['compose.yaml', demoNode(name, 'compose.yaml')!], ...tree.entries()]
  for (const [p, node] of all) {
    if (rel === '' ? p.includes('/') : !(p.startsWith(rel + '/') && !p.slice(rel.length + 1).includes('/'))) continue
    const base = p.split('/').pop()!
    if (names.has(base)) continue
    names.add(base)
    entries.push({
      name: base,
      type: node.type,
      size: node.type === 'file' ? node.content.length : 0,
      mtime: Date.now() - 3600_000,
    })
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return { path: rel, entries }
}

export function demoFileRead(event: any, name: string, path: string, download: boolean) {
  const rel = safeRelPath(path)
  const node = rel !== null ? demoNode(name, rel) : null
  if (!node || node.type !== 'file') throw createError({ statusCode: 404, statusMessage: 'no such file' })
  if (download) {
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'content-disposition', `attachment; filename="${rel!.split('/').pop()}"`)
    return Buffer.from(node.content)
  }
  return { path: rel, content: node.content }
}

export function demoFileWrite(name: string, path: string, content: string) {
  const rel = safeRelPath(path)
  const tree = demoTree(name)
  if (rel === null || rel === '' || !tree) throw createError({ statusCode: 400, statusMessage: 'invalid path' })
  if (rel === 'compose.yaml') demoStackSave(name, content, false)
  else tree.set(rel, { type: 'file', content })
  return { ok: true, path: rel }
}

export function demoFileAction(name: string, action: 'mkdir' | 'delete' | 'rename', path: string, to: string) {
  const rel = safeRelPath(path)
  const tree = demoTree(name)
  if (rel === null || rel === '' || !tree) throw createError({ statusCode: 400, statusMessage: 'invalid path' })
  if (rel === 'compose.yaml')
    throw createError({ statusCode: 400, statusMessage: "this is the stack's compose file — delete the whole stack instead" })
  if (action === 'mkdir') {
    if (demoNode(name, rel)) throw createError({ statusCode: 400, statusMessage: 'already exists' })
    tree.set(rel, { type: 'dir' })
  } else if (action === 'delete') {
    if (!demoNode(name, rel)) throw createError({ statusCode: 400, statusMessage: 'no such file or directory' })
    for (const k of [...tree.keys()]) if (k === rel || k.startsWith(rel + '/')) tree.delete(k)
  } else {
    const dest = safeRelPath(to)
    if (!dest || demoNode(name, dest)) throw createError({ statusCode: 400, statusMessage: 'invalid or existing target' })
    for (const k of [...tree.keys()]) {
      if (k === rel || k.startsWith(rel + '/')) {
        tree.set(dest + k.slice(rel.length), tree.get(k)!)
        tree.delete(k)
      }
    }
  }
  return { ok: true }
}

export function demoFileUpload(name: string, dir: string, files: { filename: string; size: number }[]) {
  const tree = demoTree(name)
  if (!tree) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })
  const saved: string[] = []
  for (const f of files) {
    const base = f.filename.split('/').pop()!
    const rel = dir ? `${dir}/${base}` : base
    tree.set(rel, { type: 'file', content: `(uploaded ${f.size} bytes in demo mode)\n` })
    saved.push(rel)
  }
  return { ok: true, saved }
}

/** Synthetic log lines so the logs panel works in demo mode. Deterministic per id+seed. */
export function demoLogLines(id: string, count: number, seed?: number): { s: 'stdout' | 'stderr'; t: string; line: string }[] {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973
  const base = seed ?? Date.now() - count * 2000
  const verbs = ['GET', 'POST', 'GET', 'GET', 'HEAD']
  const paths = ['/', '/api/health', '/assets/app.js', '/favicon.ico', '/api/items', '/login']
  const out: { s: 'stdout' | 'stderr'; t: string; line: string }[] = []
  for (let i = 0; i < count; i++) {
    const n = h + i
    const t = new Date(base + i * 2000).toISOString()
    if (n % 11 === 0) {
      out.push({ s: 'stderr', t, line: `[warn] upstream slow: took ${120 + (n % 800)}ms` })
    } else if (n % 17 === 0) {
      out.push({ s: 'stdout', t, line: `[info] health check ok (uptime ${(n % 72) + 1}h)` })
    } else {
      out.push({
        s: 'stdout',
        t,
        line: `10.0.0.${(n % 250) + 1} - "${verbs[n % verbs.length]} ${paths[n % paths.length]} HTTP/1.1" ${n % 23 === 0 ? 404 : 200} ${100 + ((n * 37) % 4000)}`,
      })
    }
  }
  return out
}

export function demoPings(): PingMap {
  const out: PingMap = {}
  // apps the demo proxy can't reach (not on the `proxy` network) answer 502, as they would for real
  const onProxy = new Set((demoNetworks().find((n) => n.name === 'proxy')?.attached ?? []).map((c) => c.id))
  seeds.forEach((s, i) => {
    for (const d of s.domains || []) {
      const url = `${d.ssl ? 'https' : 'http'}://${d.domain}`
      out[url] = !onProxy.has(`demo-${i}`) ? { status: 502, ms: 9 } : i === 7 ? { status: 0, ms: 0 } : i % 5 === 0 ? { status: 502, ms: 140 } : { status: 200, ms: 18 + ((i * 17) % 160) }
    }
  })
  return out
}

const systemdSeeds: { name: string; state: string; statusText: string; desc: string }[] = [
  { name: 'nginx.service', state: 'running', statusText: 'active · running', desc: 'A high performance web server' },
  { name: 'postgresql.service', state: 'running', statusText: 'active · running', desc: 'PostgreSQL database server' },
  { name: 'tailscaled.service', state: 'running', statusText: 'active · running', desc: 'Tailscale node agent' },
  { name: 'fail2ban.service', state: 'failed', statusText: 'failed · failed', desc: 'Ban hosts that cause multiple auth errors' },
  { name: 'certbot.service', state: 'exited', statusText: 'inactive · dead', desc: 'Certbot renewal' },
]

function demoSystemd(): Service[] {
  return systemdSeeds.map((u) => ({
    id: `systemd:${u.name}`,
    kind: 'systemd',
    name: u.name,
    displayName: u.name.replace(/\.service$/, ''),
    image: u.desc,
    state: u.state,
    statusText: u.statusText,
    health: null,
    createdAt: 0,
    ports: [],
    group: 'systemd',
    project: 'systemd',
    icon: null,
    domains: [],
    hidden: false,
    noalert: false,
  }))
}

export function demoServices(): ServicesResponse {
  const hosts = getHosts()
  const multi = hosts.length > 1
  const containers = seeds
    .map((s, i) => {
      const sv = toService(s, i)
      if (multi) sv.host = hosts[i % hosts.length].name
      return sv
    })
    .filter((sv) => !demoRemoved.has(sv.id))
  const services = [...containers, ...(getConfig().systemdEnabled ? demoSystemd() : [])]
  return {
    services,
    unmatched: [{ domains: ['old.example.com'], upstream: '172.17.0.1:9000', ssl: true }],
    stats: {
      running: services.filter((s) => s.state === 'running').length,
      total: services.length,
      groups: new Set(services.map((s) => s.group)).size,
    },
    domainProvider: 'Demo',
    controlEnabled: getConfig().allowControl,
    remoteIcons: getConfig().remoteIcons,
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, online: true, error: null })),
    generatedAt: Date.now(),
  }
}
