import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync, accessSync, readdirSync, statSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { warnOnce } from './log'
import { join, dirname } from 'node:path'
import type { Snapshot } from './collector'
import { getConfig } from './config'
import { splitServiceId } from './service-id'
import {
  type Store,
  type Uptime,
  createStore,
  recordSample,
  readStore,
  serializeStore,
  deserializeStore,
  countsAsUp,
  uptimeFor,
  uptimeDays,
  dayEdges,
  encodeKey,
  LONGEST_RETENTION_MS,
} from './history-core'

// Persists per-series CPU/mem history and uptime as small flat JSON files (one per
// container + one for the host) under ${HOMEPORT_DATA_DIR}/stats/. Zero-dependency,
// self-bounding. The pure core (ring, rollups, uptime maths) lives in ./history-core.
//
// Containers are keyed by `<hostId>|<container name>` (like the exposure report's
// accepted findings), not by container id: an update or recreate makes a new id,
// and the id-keyed files lost a container's history every time it happened.

// ---- fs / runtime layer ----

const HOST_KEY = 'host'
const SYSTEM_KEY = 'host-system'
const isHostKey = (key: string) => key === HOST_KEY || key === SYSTEM_KEY

/** Stable series key of a container: survives recreates and updates, changes on a rename. */
export function containerKey(s: { id: string; name: string }): string {
  return `${splitServiceId(s.id).hostId}|${s.name}`
}

/** Container keys are `<host id>|<docker name>`; anything else is not a key homeport writes. */
export const isContainerKey = (key: string) => /^[\w.-]{1,64}\|[a-zA-Z0-9][\w.-]{0,254}$/.test(key)

// The id-keyed file names of v2.37 and older ("c_" + id with every symbol as "_").
const legacyName = (id: string) => 'c_' + id.replace(/[^a-zA-Z0-9]+/g, '_')

const statsDir = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'stats')
function fileName(key: string): string {
  if (isHostKey(key)) return key
  const enc = encodeKey(key)
  // a file name is at most 255 bytes; a name that long gets a hash instead
  return enc.length <= 200 ? 'k_' + enc : 'k_' + createHash('sha256').update(key).digest('hex')
}
const fileFor = (key: string) => join(statsDir(), `${fileName(key)}.json`)

const cache = new Map<string, Store>()
const lastSeen = new Map<string, number>()
// v1 files whose data moved into a key's store: removed once the new file is on disk
const migrated = new Set<string>()
let persistent: boolean | null = null
let lastFlush = 0
let lastPrune = 0
const FLUSH_EVERY = 5 * 60 * 1000
const PRUNE_EVERY = 60 * 60 * 1000

/** Whether the stats dir can be written (mirrors settingsWritable's nearest-ancestor walk). */
export function historyWritable(): boolean {
  if (persistent !== null) return persistent
  try {
    let p = statsDir()
    while (!existsSync(p)) {
      const parent = dirname(p)
      if (parent === p) {
        persistent = false
        return false
      }
      p = parent
    }
    accessSync(p, constants.W_OK)
    persistent = true
  } catch {
    persistent = false
  }
  if (!persistent) {
    warnOnce('history-ro', 'history', 'data dir is not writable — CPU/RAM history is in-memory only and resets on restart')
  }
  return persistent
}

function readStoreFile(path: string): Store | null {
  try {
    return deserializeStore(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function retentionCap(): number {
  const cfg = getConfig()
  return Math.ceil((cfg.historyRetentionHours * 3600) / cfg.historyResolution)
}

/**
 * The cached store of a key, else its file, else (for a container seen for the
 * first time since the upgrade) its old id-keyed file, else a new one.
 */
function loadStore(key: string, serviceId?: string): Store {
  const cached = cache.get(key)
  if (cached) return cached
  let s = readStoreFile(fileFor(key))
  if (!s && serviceId) {
    const legacy = join(statsDir(), `${legacyName(serviceId)}.json`)
    s = readStoreFile(legacy)
    if (s) migrated.add(legacy)
  }
  s ??= createStore(getConfig().historyResolution, retentionCap())
  cache.set(key, s)
  return s
}

/** Append the latest snapshot into the in-memory series; flush/prune opportunistically. */
export function recordHistory(snap: Snapshot): void {
  if (!getConfig().historyEnabled) return
  const max = getConfig().historyMaxSeries
  const at = snap.at

  // host series (cpu %, mem %)
  if (snap.host) {
    recordSample(loadStore(HOST_KEY), at, { cpu: snap.host.cpuPercent, mem: snap.host.memPercent })
    lastSeen.set(HOST_KEY, at)
  }

  // whole-host system series (procfs) — lets graphs show container vs machine
  if (snap.host?.system) {
    recordSample(loadStore(SYSTEM_KEY), at, { cpu: snap.host.system.cpuPercent, mem: snap.host.system.memPercent })
    lastSeen.set(SYSTEM_KEY, at)
  }

  // per-container series (cpu %, mem MiB, up/down). Every listed container counts
  // toward uptime, stopped ones too; only running ones have stats to average.
  for (const s of snap.services) {
    if (s.kind !== 'container') continue
    // a host homeport can't reach says nothing about its containers: not a sample
    if (snap.hostsOnline[splitServiceId(s.id).hostId] === false) continue
    const key = containerKey(s)
    if (!cache.has(key) && cache.size >= max) continue // bound series count
    const st = snap.stats[s.id]
    recordSample(loadStore(key, s.id), at, {
      cpu: st ? st.cpuPercent ?? 0 : null,
      mem: st ? Math.round(st.memBytes / 1048576) : null,
      up: countsAsUp(s.state, s.health),
    })
    lastSeen.set(key, at)
  }

  if (at - lastFlush > FLUSH_EVERY) flush()
  if (at - lastPrune > PRUNE_EVERY) prune(at)
}

/** Persist all cached series to disk (best-effort; no-op on a read-only volume). */
export function flush(): void {
  lastFlush = Date.now()
  if (!historyWritable()) return
  try {
    mkdirSync(statsDir(), { recursive: true })
    for (const [key, s] of cache) {
      // write then rename: a crash mid-write used to leave a torn file, and a torn
      // file reads as "no history". With 30 days in it, that is worth the rename.
      const file = fileFor(key)
      writeFileSync(file + '.tmp', serializeStore(s))
      renameSync(file + '.tmp', file)
    }
  } catch {
    return // best-effort; keep the v1 files until their data is safely written
  }
  for (const f of migrated) {
    try {
      unlinkSync(f)
    } catch {
      // already gone
    }
  }
  migrated.clear()
}

/** Drop series for containers not seen within the longest retention (+ their files). */
function prune(now: number): void {
  lastPrune = now
  const graceMs = LONGEST_RETENTION_MS
  // Files of containers that are gone since before the last restart never enter
  // lastSeen, so the loop below can't reach them. An untouched file older than
  // what it can hold holds nothing readable: 30 days for a keyed file, the fine
  // retention for a v1 id-keyed one (a v1 file of a container still running was
  // migrated on its first tick; what is left belongs to recreated or removed ones).
  const legacyGraceMs = getConfig().historyRetentionHours * 3600 * 1000
  const live = new Set([...cache.keys()].map((k) => `${fileName(k)}.json`))
  if (historyWritable()) {
    try {
      for (const f of readdirSync(statsDir())) {
        if (!f.endsWith('.json') || live.has(f)) continue
        const grace = f.startsWith('c_') ? legacyGraceMs : f.startsWith('k_') ? graceMs : null
        if (grace === null) continue
        try {
          if (now - statSync(join(statsDir(), f)).mtimeMs > grace) unlinkSync(join(statsDir(), f))
        } catch {
          // raced with another delete, or unreadable: leave it
        }
      }
    } catch {
      // no stats dir yet
    }
  }
  for (const [key, seen] of lastSeen) {
    if (isHostKey(key)) continue
    if (now - seen > graceMs) {
      cache.delete(key)
      lastSeen.delete(key)
      if (historyWritable()) {
        try {
          unlinkSync(fileFor(key))
        } catch {
          // already gone
        }
      }
    }
  }
}

/**
 * A key's store for a read. A read must not create state: caching here gave every
 * requested id (a stopped container's page, a systemd unit, or any ?id= a caller
 * cares to send) an empty series that was flushed to disk, never pruned (it has no
 * lastSeen) and counted against historyMaxSeries, until new containers stopped
 * getting history at all.
 */
function peekStore(key: string): Store | null {
  return cache.get(key) ?? readStoreFile(fileFor(key))
}

/** Graph points for a series key ("host", "host-system" or a container key) over [from, to]. */
export function getHistory(key: string, fromMs: number, toMs: number) {
  const s = peekStore(key) ?? createStore(getConfig().historyResolution, retentionCap())
  return readStore(s, fromMs, toMs)
}

// how much time one sample stands for (downtime estimates); a changed interval
// makes older buckets' estimates proportionally off, the ratios stay exact
const sampleMs = () => Math.max(10, getConfig().collectorInterval) * 1000

const EMPTY_UPTIME: Uptime = { ratio: null, n: 0, up: 0, since: null, downMs: 0 }

/**
 * Uptime of a container over the last rangeMs (up to 30 days): the share of
 * collector samples in which it was running and not unhealthy. The building
 * block for the service page, /api/uptime, /api/metrics and a status page.
 */
export function getUptime(key: string, rangeMs: number, now = Date.now()): Uptime {
  const s = peekStore(key)
  return s ? uptimeFor(s, rangeMs, now, sampleMs()) : EMPTY_UPTIME
}

/** Uptime per calendar day (viewer's time zone) for the last `days` days, oldest first. */
export function getUptimeDays(key: string, days: number, tzOffsetMin: number, now = Date.now()) {
  const edges = dayEdges(now, days, tzOffsetMin)
  const s = peekStore(key)
  if (s) return uptimeDays(s, edges, sampleMs())
  return edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], ...EMPTY_UPTIME }))
}
