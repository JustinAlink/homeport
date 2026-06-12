import type { PingMap, Service, ServicesResponse, StatsMap, StatsResponse } from '~/types/service'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { startOp } from './ops'

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
]

// In-memory overrides so demo start/stop/restart actually toggle a card's state.
const demoOverrides: Record<string, 'running' | 'exited'> = {}
export function demoControl(id: string, action: 'start' | 'stop' | 'restart') {
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
    group: s.group,
    project: s.group,
    icon: null,
    domains: (s.domains || []).map((d) => ({
      domain: d.domain,
      url: `${d.ssl ? 'https' : 'http'}://${d.domain}`,
      ssl: !!d.ssl,
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
    },
  }
}

/** Synthetic CPU/mem history so the graphs look alive in demo mode (no Docker). */
export function demoHistory(id: string, fromMs: number, toMs: number, res: number) {
  const isHost = id === 'host'
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
    cpu.push(Math.max(0, Math.round((20 + Math.sin(x / 15 + h) * 12 + Math.sin(x / 3 + h) * 4) * 10) / 10))
    mem.push(
      isHost
        ? Math.max(5, Math.round((45 + Math.sin(x / 40 + h) * 15) * 10) / 10) // percent
        : Math.max(20, Math.round(120 + (h % 500) + Math.sin(x / 20 + h) * 40)), // MiB
    )
  }
  return { res, t, cpu, mem }
}

// Demo update statuses — jellyfin + vaultwarden start with updates available;
// "applying" flips them to current so the whole flow is clickable without Docker.
const demoUpdateState: Record<string, 'update' | 'current'> = {}
export function demoUpdates(): Record<string, any> {
  const out: Record<string, any> = {}
  seeds.forEach((s, i) => {
    const key = `default|${s.image}`
    const seeded = i === 0 || i === 8 ? 'update' : 'current'
    const status = demoUpdateState[key] ?? seeded
    out[key] = {
      status,
      localDigest: `sha256:${'ab'.repeat(8)}${i}`,
      remoteDigest: status === 'update' ? `sha256:${'cd'.repeat(8)}${i}` : `sha256:${'ab'.repeat(8)}${i}`,
      checkedAt: Date.now() - 3600_000,
    }
  })
  return out
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

// ---- demo stacks (group seeds presented as compose stacks) ----

const demoStackContent = new Map<string, string>()

function synthCompose(group: string): string {
  const members = seeds.filter((s) => s.group === group)
  const svc = (s: Seed) =>
    [
      `  ${s.name}:`,
      `    image: ${s.image}`,
      `    restart: unless-stopped`,
      ...(s.ports?.length ? [`    ports:`, ...s.ports.map((p) => `      - "${p}:${p}"`)] : []),
    ].join('\n')
  return `services:\n${members.map(svc).join('\n')}\n`
}

export function demoStackList() {
  const groups = [...new Set(seeds.map((s) => s.group))]
  const stacks = groups.map((g) => {
    const members = seeds.map((s, i) => ({ s, i })).filter(({ s }) => s.group === g)
    const running = members.filter(({ s, i }) => (demoOverrides[`demo-${i}`] || s.state || 'running') === 'running').length
    const total = members.length
    return {
      name: g,
      state: running === 0 ? 'stopped' : running === total ? 'running' : 'partial',
      running,
      total,
      file: 'compose.yaml',
    }
  })
  return { stacks, unmanaged: [{ name: 'legacy-app', running: 1, total: 1 }], dir: '/stacks' }
}

export function demoStackRead(name: string) {
  if (![...new Set(seeds.map((s) => s.group))].includes(name) && !demoStackContent.has(name)) return null
  return { name, file: 'compose.yaml', content: demoStackContent.get(name) ?? synthCompose(name) }
}

export function demoStackSave(name: string, content: string, _create: boolean) {
  demoStackContent.set(name, content)
  return { ok: true, stack: { name, file: 'compose.yaml', content } }
}

export function demoStackAction(name: string, op: string): string {
  // run a scripted op through the real registry so SSE streaming is identical
  const lines =
    op === 'pull'
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
    return true
  })
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
  seeds.forEach((s, i) => {
    for (const d of s.domains || []) {
      const url = `${d.ssl ? 'https' : 'http'}://${d.domain}`
      out[url] = i === 7 ? { status: 0, ms: 0 } : i % 5 === 0 ? { status: 502, ms: 140 } : { status: 200, ms: 18 + ((i * 17) % 160) }
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
  const containers = seeds.map((s, i) => {
    const sv = toService(s, i)
    if (multi) sv.host = hosts[i % hosts.length].name
    return sv
  })
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
