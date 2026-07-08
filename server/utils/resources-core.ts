// Pure CPU/memory resource-limit logic for the live `docker update` editor —
// unit-testable in isolation. Scope is CPU + memory only: Healthcheck lives on
// the container's immutable Config and cannot be live-updated (needs recreate),
// so it's intentionally not handled here.

/** Fixed CPU accounting period (microseconds), matching `docker update --cpus` UX. */
export const CPU_PERIOD_US = 100000

// The Engine API's live-update endpoint can only ever *set* a limit — the
// daemon's own merge logic (toContainerdResources) treats a 0 byte/quota value
// the same as "field not provided" and just keeps the old limit in place (the
// same reason `docker update --blkio-weight 0` / `--cpu-shares 0` don't reset
// those to defaults either — a known upstream daemon limitation, not a
// choice we're making). So there is no live-update request that clears a
// previously-set CPU or memory limit; the container has to be recreated
// (redeploy the compose stack, or `docker rm` + re-`run`) instead. We reject
// an explicit 0 up front rather than forwarding it, since forwarding it would
// report success while silently leaving the old limit untouched.
const CANNOT_CLEAR_VIA_LIVE_UPDATE =
  "Docker can't remove a CPU/memory limit through a live update once it's set — recreate the container (e.g. redeploy the stack) to clear it."

/** "cores" (e.g. 2, 0.5) → { cpuQuota, cpuPeriod } at the fixed period. 0/undefined = unlimited (omit quota). */
export function coresToQuota(cores: number | undefined | null): { cpuQuota: number; cpuPeriod: number } | null {
  if (cores === undefined || cores === null || !Number.isFinite(cores) || cores <= 0) return null
  return { cpuQuota: Math.round(cores * CPU_PERIOD_US), cpuPeriod: CPU_PERIOD_US }
}

/** { cpuQuota, cpuPeriod } (raw HostConfig numbers) → "cores" for display. 0/missing period or quota = unlimited (null). */
export function quotaToCores(cpuQuota: number | undefined | null, cpuPeriod: number | undefined | null): number | null {
  if (!cpuQuota || cpuQuota <= 0 || !cpuPeriod || cpuPeriod <= 0) return null
  return Math.round((cpuQuota / cpuPeriod) * 1000) / 1000
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
}

/**
 * Parse a human size string ("512m", "2g", "1024k", "100", plain bytes) to bytes.
 * Returns null for blank/absent input (field not provided — leave unchanged).
 * Throws on an unparsable or negative string. An explicit zero throws
 * CANNOT_CLEAR_VIA_LIVE_UPDATE unless `allowZero` is set — memorySwap is the
 * one field where 0 has a sane meaning (buildUpdateFields treats it as "-1").
 */
export function parseByteSize(input: string | number | undefined | null, opts?: { allowZero?: boolean }): number | null {
  if (input === undefined || input === null) return null
  const allowZero = opts?.allowZero ?? false
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error(`invalid size ${input} — must be a positive number of bytes`)
    if (input === 0) {
      if (allowZero) return 0
      throw new Error(CANNOT_CLEAR_VIA_LIVE_UPDATE)
    }
    return Math.round(input)
  }
  const s = input.trim()
  if (!s) return null
  const m = /^([0-9]*\.?[0-9]+)\s*([a-zA-Z]{0,2})$/.exec(s)
  if (!m) throw new Error(`could not parse size "${input}" — try e.g. "512m" or "2g"`)
  const n = Number(m[1])
  const unit = m[2].toLowerCase() || 'b'
  const mult = SIZE_UNITS[unit]
  if (!Number.isFinite(n) || n < 0 || !mult) throw new Error(`could not parse size "${input}" — try e.g. "512m" or "2g"`)
  if (n === 0) {
    if (allowZero) return 0
    throw new Error(CANNOT_CLEAR_VIA_LIVE_UPDATE)
  }
  return Math.round(n * mult)
}

/** Bytes → the shortest human size string round-tripping through parseByteSize ("g"/"m"/"k"/"b"). */
export function formatByteSize(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes % SIZE_UNITS.g === 0) return `${bytes / SIZE_UNITS.g}g`
  if (bytes % SIZE_UNITS.m === 0) return `${bytes / SIZE_UNITS.m}m`
  if (bytes % SIZE_UNITS.k === 0) return `${bytes / SIZE_UNITS.k}k`
  return String(bytes)
}

export interface ResourcesInput {
  cpus?: number | null // convenience "cores" field
  cpuQuota?: number | null
  cpuPeriod?: number | null
  cpusetCpus?: string | null
  memory?: string | number | null
  memoryReservation?: string | number | null
  memorySwap?: string | number | null
}

/** Raw HostConfig fields dockerode's `.update()` accepts for a running container. */
export interface UpdateFields {
  CpuQuota?: number
  CpuPeriod?: number
  CpusetCpus?: string
  Memory?: number
  MemoryReservation?: number
  MemorySwap?: number
}

/**
 * Turn the API body into the exact set of dockerode `.update()` fields — only
 * fields the caller actually provided (0 is a daemon no-op, not "clear", so
 * unset fields are omitted rather than zeroed — see CANNOT_CLEAR_VIA_LIVE_UPDATE
 * for why an *explicit* 0 is rejected rather than silently omitted too). Memory
 * swap defaults to -1 (unlimited) whenever memory is being set but swap wasn't
 * explicitly given, sidestepping the daemon's "MemorySwap must be -1 or >=
 * Memory" rejection; an explicit 0/blank for memorySwap itself also becomes -1,
 * since 0 has no valid meaning as a memory+swap ceiling.
 */
export function buildUpdateFields(input: ResourcesInput): UpdateFields {
  const out: UpdateFields = {}

  if (input.cpus !== undefined && input.cpus !== null) {
    const cores = Number(input.cpus)
    if (Number.isFinite(cores) && cores === 0) throw new Error(CANNOT_CLEAR_VIA_LIVE_UPDATE)
    const q = coresToQuota(cores)
    if (!q) throw new Error('cpus must be a positive number')
    out.CpuQuota = q.cpuQuota
    out.CpuPeriod = q.cpuPeriod
  } else {
    if (input.cpuQuota !== undefined && input.cpuQuota !== null) {
      const n = Number(input.cpuQuota)
      if (!Number.isFinite(n) || n < 0) throw new Error('cpuQuota must be a non-negative number')
      out.CpuQuota = Math.round(n)
    }
    if (input.cpuPeriod !== undefined && input.cpuPeriod !== null) {
      const n = Number(input.cpuPeriod)
      if (!Number.isFinite(n) || n <= 0) throw new Error('cpuPeriod must be a positive number')
      out.CpuPeriod = Math.round(n)
    }
  }

  if (input.cpusetCpus !== undefined && input.cpusetCpus !== null) {
    const v = String(input.cpusetCpus).trim()
    if (v && !/^[0-9,-]+$/.test(v)) throw new Error('cpusetCpus must look like "0-1" or "0,2"')
    out.CpusetCpus = v
  }

  const memory = input.memory !== undefined && input.memory !== null ? parseByteSize(input.memory) : null
  if (memory !== null) out.Memory = memory

  if (input.memoryReservation !== undefined && input.memoryReservation !== null) {
    const r = parseByteSize(input.memoryReservation)
    if (r !== null) out.MemoryReservation = r
  }

  if (input.memorySwap !== undefined && input.memorySwap !== null) {
    const sw = parseByteSize(input.memorySwap, { allowZero: true })
    out.MemorySwap = sw !== null && sw !== 0 ? sw : -1
  } else if (memory !== null) {
    // memory is changing but swap wasn't specified — default to unlimited so the
    // daemon's "MemorySwap >= Memory" constraint never trips on a stale value.
    out.MemorySwap = -1
  }

  if (Object.keys(out).length === 0) throw new Error('no resource fields provided')
  return out
}

/** Trim HTML/whitespace noise and classify a dockerode/daemon error for a clean HTTP response. */
export function mapResourcesError(e: any): { statusCode: number; statusMessage: string } {
  const reason = String(e?.message || e || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  // Daemon validation rejections (bad cpuset, MemorySwap < Memory, etc.) come back
  // as 400s from the Engine API — dockerode surfaces the status in the message.
  const isValidation = /400|invalid|must be|cannot be less than|minimum/i.test(reason)
  return {
    statusCode: isValidation ? 400 : 502,
    statusMessage: reason || 'update failed',
  }
}
