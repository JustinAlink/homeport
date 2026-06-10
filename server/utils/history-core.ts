// Pure, dependency-free time-series core (ring of recent points). Kept import-free
// so it's unit-testable in isolation (node --experimental-strip-types --test).

export interface Series {
  res: number // seconds per slot (downsample resolution)
  cap: number // max retained points
  t: number[] // slot-start unix ms, strictly ascending
  cpu: number[] // CPU % per slot
  mem: number[] // memory MiB per slot (matches the client convention)
}

export function createSeries(res = 60, cap = 1440): Series {
  return { res: Math.max(1, Math.floor(res)), cap: Math.max(1, Math.floor(cap)), t: [], cpu: [], mem: [] }
}

const slotOf = (atMs: number, res: number) => Math.floor(atMs / (res * 1000)) * (res * 1000)

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
  const over = s.t.length - s.cap
  if (over > 0) {
    s.t.splice(0, over)
    s.cpu.splice(0, over)
    s.mem.splice(0, over)
  }
  return s
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

export function serialize(s: Series): string {
  return JSON.stringify({ res: s.res, cap: s.cap, t: s.t, cpu: s.cpu, mem: s.mem })
}

export function deserialize(raw: string): Series | null {
  try {
    const o = JSON.parse(raw)
    if (!o || !Array.isArray(o.t) || !Array.isArray(o.cpu) || !Array.isArray(o.mem)) return null
    return { res: o.res || 60, cap: o.cap || 1440, t: o.t, cpu: o.cpu, mem: o.mem }
  } catch {
    return null
  }
}
