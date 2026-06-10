import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, accessSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Snapshot } from './collector'
import { getConfig } from './config'
import { type Series, createSeries, appendPoint, readRange, serialize, deserialize } from './history-core'

// Persists per-series CPU/mem history as small flat JSON files (one per container +
// one for the host) under ${HOMEPORT_DATA_DIR}/stats/. Zero-dependency, self-bounding.
// The pure ring-buffer core lives in ./history-core (unit-tested in isolation).

// ---- fs / runtime layer ----

const HOST_KEY = 'host'
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
  return persistent
}

function loadSeries(key: string): Series {
  const cached = cache.get(key)
  if (cached) return cached
  let s: Series | null = null
  try {
    s = deserialize(readFileSync(fileFor(key), 'utf8'))
  } catch {
    s = null
  }
  if (!s) s = createSeries(getConfig().historyResolution, retentionCap())
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
  const s = loadSeries(key)
  return readRange(s, fromMs, toMs)
}
