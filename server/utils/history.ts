import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, accessSync, readdirSync, statSync, constants } from 'node:fs'
import { warnOnce } from './log'
import { join, dirname } from 'node:path'
import type { Snapshot } from './collector'
import { getConfig } from './config'
import { type Series, createSeries, appendPoint, readRange, serialize, deserialize } from './history-core'

// Persists per-series CPU/mem history as small flat JSON files (one per container +
// one for the host) under ${HOMEPORT_DATA_DIR}/stats/. Zero-dependency, self-bounding.
// The pure ring-buffer core lives in ./history-core (unit-tested in isolation).

// ---- fs / runtime layer ----

const HOST_KEY = 'host'
const SYSTEM_KEY = 'host-system'
const safeKey = (id: string) => 'c_' + id.replace(/[^a-zA-Z0-9]+/g, '_')

const statsDir = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'stats')
const fileFor = (key: string) => join(statsDir(), `${key}.json`)

const cache = new Map<string, Series>()
const lastSeen = new Map<string, number>()
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

function readSeriesFile(key: string): Series | null {
  try {
    return deserialize(readFileSync(fileFor(key), 'utf8'))
  } catch {
    return null
  }
}

function loadSeries(key: string): Series {
  const cached = cache.get(key)
  if (cached) return cached
  const s = readSeriesFile(key) ?? createSeries(getConfig().historyResolution, retentionCap())
  cache.set(key, s)
  return s
}

function retentionCap(): number {
  const cfg = getConfig()
  return Math.ceil((cfg.historyRetentionHours * 3600) / cfg.historyResolution)
}

/** Append the latest snapshot into the in-memory series; flush/prune opportunistically. */
export function recordHistory(snap: Snapshot): void {
  if (!getConfig().historyEnabled) return
  const max = getConfig().historyMaxSeries
  const at = snap.at

  // host series (cpu %, mem %)
  if (snap.host) {
    const s = loadSeries(HOST_KEY)
    appendPoint(s, at, snap.host.cpuPercent, snap.host.memPercent)
    lastSeen.set(HOST_KEY, at)
  }

  // whole-host system series (procfs) — lets graphs show container vs machine
  if (snap.host?.system) {
    const s = loadSeries(SYSTEM_KEY)
    appendPoint(s, at, snap.host.system.cpuPercent, snap.host.system.memPercent)
    lastSeen.set(SYSTEM_KEY, at)
  }

  // per-container series (cpu %, mem MiB)
  for (const [id, st] of Object.entries(snap.stats)) {
    const key = safeKey(id)
    if (!cache.has(key) && cache.size >= max) continue // bound series count
    const s = loadSeries(key)
    appendPoint(s, at, st.cpuPercent ?? 0, Math.round(st.memBytes / 1048576))
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
    for (const [key, s] of cache) writeFileSync(fileFor(key), serialize(s))
  } catch {
    // best-effort
  }
}

/** Drop series for containers not seen within the retention window (+ their files). */
function prune(now: number): void {
  lastPrune = now
  const graceMs = getConfig().historyRetentionHours * 3600 * 1000
  // Files of containers that are gone since before the last restart never enter
  // lastSeen, so the loop below can't reach them: they piled up for every recreate.
  // An untouched file older than the retention window holds nothing readable.
  if (historyWritable()) {
    try {
      for (const f of readdirSync(statsDir())) {
        const key = f.replace(/\.json$/, '')
        if (!f.endsWith('.json') || !key.startsWith('c_') || cache.has(key)) continue
        try {
          if (now - statSync(join(statsDir(), f)).mtimeMs > graceMs) unlinkSync(join(statsDir(), f))
        } catch {
          // raced with another delete, or unreadable: leave it
        }
      }
    } catch {
      // no stats dir yet
    }
  }
  for (const [key, seen] of lastSeen) {
    if (key === HOST_KEY) continue
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

/** Read a series for an API request. id = a service id ("hostId::cid") or "host". */
export function getHistory(id: string, fromMs: number, toMs: number) {
  const key = id === HOST_KEY ? HOST_KEY : safeKey(id)
  // A read must not create state. Caching here gave every requested id (a stopped
  // container's page, a systemd unit, or any ?id= a caller cares to send) an empty
  // series that was flushed to disk, never pruned (it has no lastSeen) and counted
  // against historyMaxSeries, until new containers stopped getting history at all.
  const s = cache.get(key) ?? readSeriesFile(key) ?? createSeries(getConfig().historyResolution, retentionCap())
  return readRange(s, fromMs, toMs)
}
