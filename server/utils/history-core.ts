// Pure, dependency-free time-series core (ring of recent points). Kept import-free
// so it's unit-testable in isolation (node --experimental-strip-types --test).
//
// One series file holds three tiers:
//   fine:  the last `historyRetentionHours` at `historyResolution` (24 h at 1 min)
//   15 min buckets for 7 days, 1 h buckets for 30 days (ROLLUP_TIERS)
// The rollups are fed with every collector sample (not with the fine slots), so a
// bucket averages everything that was measured in it. They also count uptime
// samples, which is why they keep counts and not only means.

export interface Series {
  res: number // seconds per slot (downsample resolution)
  cap: number // max retained points
  t: number[] // slot-start unix ms, strictly ascending
  cpu: number[] // CPU % per slot
  mem: number[] // memory MiB per slot (matches the client convention)
}

/** A coarse tier: per bucket, the mean of the resource samples plus uptime counts. */
export interface Rollup {
  res: number // seconds per bucket
  cap: number // buckets kept (res * cap = how far back it reaches)
  t: number[] // bucket-start unix ms, strictly ascending
  cpu: number[] // mean CPU % of the w resource samples (0 while w = 0)
  mem: number[] // mean memory (MiB for containers, % for the host series)
  w: number[] // resource samples averaged in (0 = stopped the whole bucket: a gap)
  n: number[] // status samples (the container was listed while homeport watched)
  up: number[] // of those, how many counted as up (see countsAsUp)
}

/** Everything one series file holds. */
export interface Store {
  fine: Series
  tiers: Rollup[]
}

/**
 * 15 min x 7 d and 1 h x 30 d. A graph is about 600 to 1000 px wide, so ~700
 * points per range is one point per pixel or so (DockMon aims at 500 per view;
 * Beszel's 2 h / 8 h buckets give only 84 / 90 points and read as blocky). Hourly
 * for 30 days is also what Uptime Kuma 2 keeps (stat_hourly). Both are exact
 * multiples of a minute, so they nest on the same clock as the fine tier.
 */
export const ROLLUP_TIERS: readonly { res: number; cap: number }[] = [
  { res: 15 * 60, cap: 7 * 96 }, // 672 buckets
  { res: 60 * 60, cap: 30 * 24 }, // 720 buckets
]

/** The longest any tier reaches back, in ms: how long a removed container's file is kept. */
export const LONGEST_RETENTION_MS = Math.max(...ROLLUP_TIERS.map((t) => t.res * t.cap * 1000))

/** The longest range the API serves, in hours (30 days: the coarsest tier). */
export const MAX_RANGE_HOURS = 30 * 24

/** "6h" / "7d" → hours, clamped to 1 h .. 30 d; anything else → fallback. */
export function parseRangeHours(raw: unknown, fallback = 6): number {
  const m = String(raw ?? '').match(/^(\d{1,4})([hd])$/)
  if (!m) return fallback
  const hours = Number(m[1]) * (m[2] === 'd' ? 24 : 1)
  return Math.min(MAX_RANGE_HOURS, Math.max(1, hours))
}

/** A graph never gets more points than this; past it, the next coarser tier answers. */
export const MAX_POINTS = 1500

export function createSeries(res = 60, cap = 1440): Series {
  return { res: Math.max(1, Math.floor(res)), cap: Math.max(1, Math.floor(cap)), t: [], cpu: [], mem: [] }
}

export function createRollup(res: number, cap: number): Rollup {
  return { res: Math.max(1, Math.floor(res)), cap: Math.max(1, Math.floor(cap)), t: [], cpu: [], mem: [], w: [], n: [], up: [] }
}

export function createStore(fineRes = 60, fineCap = 1440): Store {
  return { fine: createSeries(fineRes, fineCap), tiers: ROLLUP_TIERS.map((t) => createRollup(t.res, t.cap)) }
}

const slotOf = (atMs: number, res: number) => Math.floor(atMs / (res * 1000)) * (res * 1000)

/**
 * Drop what fell out of the window. By count (the cap) and by age: after homeport
 * was off for a week, the count alone would keep month-old buckets that no longer
 * belong to "the last 30 days" and would skew an uptime figure.
 */
function trimTo<T extends { res: number; cap: number; t: number[] }>(s: T, newestSlot: number, cols: (keyof T)[]): void {
  const oldest = newestSlot - (s.cap - 1) * s.res * 1000
  let drop = Math.max(0, s.t.length - s.cap)
  while (drop < s.t.length && s.t[drop] < oldest) drop++
  if (drop > 0) for (const c of cols) (s[c] as unknown as number[]).splice(0, drop)
}

/** Append a sample. Same slot → last sample wins; older slot → ignored; trims to cap. */
export function appendPoint(s: Series, atMs: number, cpu: number, mem: number): Series {
  const slot = slotOf(atMs, s.res)
  const last = s.t.length - 1
  if (last >= 0 && s.t[last] === slot) {
    s.cpu[last] = cpu
    s.mem[last] = mem
    return s
  }
  if (last >= 0 && slot < s.t[last]) return s // out-of-order/old — ignore
  s.t.push(slot)
  s.cpu.push(cpu)
  s.mem.push(mem)
  trimTo(s, slot, ['t', 'cpu', 'mem'])
  return s
}

/** One collector observation. cpu/mem only while it runs; up only for containers. */
export interface Sample {
  cpu?: number | null
  mem?: number | null
  up?: boolean | null
}

const ROLLUP_COLS: (keyof Rollup)[] = ['t', 'cpu', 'mem', 'w', 'n', 'up']

/** Fold a sample into its bucket: a running mean (weighted by w) plus the uptime counts. */
export function addToRollup(r: Rollup, atMs: number, s: Sample): Rollup {
  const slot = slotOf(atMs, r.res)
  let i = r.t.length - 1
  if (i >= 0 && slot < r.t[i]) return r // out-of-order/old: ignore
  if (i < 0 || slot > r.t[i]) {
    r.t.push(slot)
    r.cpu.push(0)
    r.mem.push(0)
    r.w.push(0)
    r.n.push(0)
    r.up.push(0)
    trimTo(r, slot, ROLLUP_COLS)
    i = r.t.length - 1
  }
  if (s.cpu != null && s.mem != null) {
    const w = ++r.w[i]
    r.cpu[i] += (s.cpu - r.cpu[i]) / w
    r.mem[i] += (s.mem - r.mem[i]) / w
  }
  if (s.up != null) {
    r.n[i]++
    if (s.up) r.up[i]++
  }
  return r
}

/** One collector sample into every tier of a series. */
export function recordSample(store: Store, atMs: number, s: Sample): Store {
  if (s.cpu != null && s.mem != null) appendPoint(store.fine, atMs, s.cpu, s.mem)
  for (const r of store.tiers) addToRollup(r, atMs, s)
  return store
}

/**
 * What counts as "up" for uptime: running, and not failing its health check.
 * `starting` counts as up: it lasts at most the start period plus a few retries
 * and then turns healthy or unhealthy, so counting it as down would charge every
 * deliberate restart or update as an outage. paused/restarting/exited are down.
 */
export function countsAsUp(state: string, health: string | null | undefined): boolean {
  return state === 'running' && health !== 'unhealthy'
}

/**
 * Read [fromMs, toMs] as a continuous, evenly-spaced series at `res` (missing
 * slots gap-filled with null), so a line graph can plot it by index without
 * distorting time.
 */
export function readRange(s: Series, fromMs: number, toMs: number): {
  res: number
  t: number[]
  cpu: (number | null)[]
  mem: (number | null)[]
} {
  const step = s.res * 1000
  const start = slotOf(fromMs, s.res)
  const end = slotOf(toMs, s.res)
  const have = new Map<number, number>()
  for (let i = 0; i < s.t.length; i++) have.set(s.t[i], i)
  const t: number[] = []
  const cpu: (number | null)[] = []
  const mem: (number | null)[] = []
  for (let slot = start; slot <= end; slot += step) {
    t.push(slot)
    const i = have.get(slot)
    cpu.push(i === undefined ? null : s.cpu[i])
    mem.push(i === undefined ? null : s.mem[i])
  }
  return { res: s.res, t, cpu, mem }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** Same shape as readRange, from a rollup tier. A bucket with no resource sample is a gap. */
export function readRollup(r: Rollup, fromMs: number, toMs: number): ReturnType<typeof readRange> {
  const step = r.res * 1000
  const start = slotOf(fromMs, r.res)
  const end = slotOf(toMs, r.res)
  const have = new Map<number, number>()
  for (let i = 0; i < r.t.length; i++) have.set(r.t[i], i)
  const t: number[] = []
  const cpu: (number | null)[] = []
  const mem: (number | null)[] = []
  for (let slot = start; slot <= end; slot += step) {
    t.push(slot)
    const i = have.get(slot)
    const ok = i !== undefined && r.w[i] > 0
    cpu.push(ok ? round(r.cpu[i!], 1) : null)
    mem.push(ok ? round(r.mem[i!], 1) : null)
  }
  return { res: r.res, t, cpu, mem }
}

/**
 * Index of the tier that answers a range: the finest one that reaches back far
 * enough without drawing more than maxPoints. Past every tier, the coarsest.
 * Tiers are given finest first ({res, cap} is all it needs, so the demo can use it).
 */
export function pickTier(tiers: readonly { res: number; cap: number }[], rangeMs: number, maxPoints = MAX_POINTS): number {
  for (let i = 0; i < tiers.length; i++) {
    const step = tiers[i].res * 1000
    if (tiers[i].cap * step >= rangeMs && rangeMs / step <= maxPoints) return i
  }
  return tiers.length - 1
}

/** A graph's worth of points for [fromMs, toMs], from whichever tier fits. */
export function readStore(store: Store, fromMs: number, toMs: number, maxPoints = MAX_POINTS): ReturnType<typeof readRange> {
  const i = pickTier([store.fine, ...store.tiers], toMs - fromMs, maxPoints)
  return i === 0 ? readRange(store.fine, fromMs, toMs) : readRollup(store.tiers[i - 1], fromMs, toMs)
}

export interface Uptime {
  /** up / observed samples, or null when homeport saw nothing in the window */
  ratio: number | null
  n: number
  up: number
  /** where the observed data starts inside the window (younger than the window = fewer days to judge) */
  since: number | null
  /** estimated time down in the window (see uptimeIn) */
  downMs: number
}

/**
 * Uptime over [fromMs, toMs) from one rollup tier: counts of every bucket that
 * overlaps the window (half-open, so back-to-back days never share a bucket).
 * Only observed samples count, so time homeport was not running is neither up
 * nor down (Uptime Kuma does the same with its heartbeats).
 *
 * downMs is an estimate: down samples times the collector interval (sampleMs).
 * Spreading a bucket's down share over its whole span instead overstated it for
 * a bucket homeport only saw part of (a fresh container, homeport restarting):
 * one down sample in a minute-old bucket read as minutes down. Without sampleMs
 * it falls back to that share.
 */
export function uptimeIn(r: Rollup, fromMs: number, toMs: number, sampleMs?: number): Uptime {
  const step = r.res * 1000
  let n = 0
  let up = 0
  let since: number | null = null
  let downMs = 0
  for (let i = 0; i < r.t.length; i++) {
    const t = r.t[i]
    if (t + step <= fromMs || t >= toMs || !r.n[i]) continue
    n += r.n[i]
    up += r.up[i]
    if (since === null) since = Math.max(t, fromMs)
    const span = Math.max(0, Math.min(t + step, toMs) - Math.max(t, fromMs))
    const down = r.n[i] - r.up[i]
    // a bucket cut by the window edge: only its share inside the window
    downMs += sampleMs ? Math.min(span, down * sampleMs * (span / step)) : (down / r.n[i]) * span
  }
  return { ratio: n ? up / n : null, n, up, since, downMs: Math.round(downMs) }
}

/** Uptime over the last rangeMs, from the finest rollup that reaches back that far. */
export function uptimeFor(store: Store, rangeMs: number, now: number, sampleMs?: number): Uptime {
  const i = pickTier(store.tiers, rangeMs, Infinity)
  return uptimeIn(store.tiers[i], now - rangeMs, now, sampleMs)
}

/**
 * Start of each of the last `days` calendar days in the viewer's time zone, plus
 * `now` as the end of today. tzOffsetMin is Date#getTimezoneOffset() (UTC minus
 * local, so -60 in CET). A DST change inside the range shifts a day edge by an hour.
 */
export function dayEdges(now: number, days: number, tzOffsetMin: number): number[] {
  const DAY = 86_400_000
  const off = tzOffsetMin * 60_000
  const today = Math.floor((now - off) / DAY) * DAY + off
  const edges: number[] = []
  for (let k = days - 1; k >= 0; k--) edges.push(today - k * DAY)
  edges.push(now)
  return edges
}

/** Uptime per window between consecutive edges (e.g. dayEdges), from the 30-day tier. */
export function uptimeDays(store: Store, edges: number[], sampleMs?: number): (Uptime & { from: number; to: number })[] {
  const r = store.tiers[store.tiers.length - 1]
  const out: (Uptime & { from: number; to: number })[] = []
  for (let i = 0; i + 1 < edges.length; i++) out.push({ from: edges[i], to: edges[i + 1], ...uptimeIn(r, edges[i], edges[i + 1], sampleMs) })
  return out
}

/**
 * Series file name for a key: anything outside [A-Za-z0-9_.-] becomes ~XX (its
 * UTF-8 bytes in hex), so "default|my-app" and "default|my_app" never share a
 * file (the old id-keyed names folded every symbol into "_").
 */
export function encodeKey(key: string): string {
  let out = ''
  for (const b of new TextEncoder().encode(key)) {
    const c = String.fromCharCode(b)
    out += /[A-Za-z0-9_.-]/.test(c) ? c : '~' + b.toString(16).padStart(2, '0')
  }
  return out
}

export function serialize(s: Series): string {
  return JSON.stringify({ res: s.res, cap: s.cap, t: s.t, cpu: s.cpu, mem: s.mem })
}

export function deserialize(raw: string): Series | null {
  try {
    return seriesFrom(JSON.parse(raw))
  } catch {
    return null
  }
}

const numArray = (a: unknown): a is number[] => Array.isArray(a) && a.every((v) => typeof v === 'number' && Number.isFinite(v))

function seriesFrom(o: any): Series | null {
  if (!o || !Array.isArray(o.t) || !Array.isArray(o.cpu) || !Array.isArray(o.mem)) return null
  return { res: o.res || 60, cap: o.cap || 1440, t: o.t, cpu: o.cpu, mem: o.mem }
}

function rollupFrom(o: any, res: number, cap: number): Rollup | null {
  if (!o || o.res !== res) return null
  const t = unpackT(o, res)
  const cols = [t, o.cpu, o.mem, o.w, o.n, o.up]
  if (!t || !cols.every(numArray) || !cols.every((c: number[]) => c.length === t.length)) return null
  return { res, cap, t, cpu: o.cpu, mem: o.mem, w: o.w, n: o.n, up: o.up }
}

// Times on disk: the first one plus the steps between them in slots (almost all
// 1). Thirteen-digit timestamps were half of every file; this keeps a full
// 30-day series near 45 KB instead of 80.
function packT(t: number[], res: number): { t0: number; dt: number[] } {
  const step = res * 1000
  return { t0: t[0] ?? 0, dt: t.slice(1).map((v, i) => Math.round((v - t[i]) / step)) }
}
function unpackT(o: any, res: number): number[] | null {
  if (Array.isArray(o.t)) return o.t
  if (typeof o.t0 !== 'number' || !numArray(o.dt)) return null
  const t = o.cpu?.length ? [o.t0] : []
  for (const d of o.dt) t.push(t[t.length - 1] + d * res * 1000)
  return t
}

/** Version 2: the fine ring plus the rollups. Means are rounded: the files stay small. */
export function serializeStore(s: Store): string {
  return JSON.stringify({
    v: 2,
    fine: { res: s.fine.res, cap: s.fine.cap, ...packT(s.fine.t, s.fine.res), cpu: s.fine.cpu, mem: s.fine.mem },
    tiers: s.tiers.map((r) => ({
      res: r.res,
      cap: r.cap,
      ...packT(r.t, r.res),
      cpu: r.cpu.map((v) => round(v, 2)),
      mem: r.mem.map((v) => round(v, 1)),
      w: r.w,
      n: r.n,
      up: r.up,
    })),
  })
}

/**
 * Read a series file, either version. A v1 file (the bare 24 h ring, before
 * rollups) is migrated: its points become the fine tier and are replayed into the
 * rollups as resource samples, so 7 d and 30 d show that day straight away. It
 * carries no uptime: a v1 file only has points while the container ran, so its
 * gaps can't tell "stopped" from "homeport was off", and counting them as up
 * would claim 100%. Uptime starts with the first sample after the upgrade.
 * A tier that is missing or damaged starts empty instead of failing the file.
 */
export function deserializeStore(raw: string): Store | null {
  let o: any
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (o && o.v === 2) {
    const ft = o.fine ? unpackT(o.fine, o.fine.res || 60) : null
    const fine = ft ? seriesFrom({ ...o.fine, t: ft }) : null
    if (!fine || fine.t.length !== fine.cpu.length || fine.t.length !== fine.mem.length) return null
    const saved: any[] = Array.isArray(o.tiers) ? o.tiers : []
    const tiers = ROLLUP_TIERS.map((def) => {
      for (const t of saved) {
        const r = rollupFrom(t, def.res, def.cap)
        if (r) return r
      }
      return createRollup(def.res, def.cap)
    })
    return { fine, tiers }
  }
  const fine = seriesFrom(o)
  if (!fine) return null
  const store: Store = { fine, tiers: ROLLUP_TIERS.map((t) => createRollup(t.res, t.cap)) }
  for (let i = 0; i < fine.t.length; i++) for (const r of store.tiers) addToRollup(r, fine.t[i], { cpu: fine.cpu[i], mem: fine.mem[i] })
  return store
}
