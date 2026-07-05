// Pure env-variable logic for the container Environment editor — unit-testable
// in isolation.

export interface EnvEntry {
  key: string
  /** null = value withheld (secret) on read, or "keep the existing value" on write. */
  value: string | null
  secret: boolean
}

/** Keys whose values are withheld from the client (over-masking is fine — the
 *  admin can always overwrite; they just can't read the current value back). */
export function isSecretEnvKey(key: string): boolean {
  return /(pass(word|wd)?|secret|token|credential|api_?key|private|[_-]key$|^key$)/i.test(key)
}

/** `KEY=value` strings → editor entries (secrets withheld). */
export function parseEnv(env: string[]): EnvEntry[] {
  return env.map((line) => {
    const eq = line.indexOf('=')
    const key = eq === -1 ? line : line.slice(0, eq)
    const value = eq === -1 ? '' : line.slice(eq + 1)
    const secret = isSecretEnvKey(key)
    return { key, value: secret ? null : value, secret }
  })
}

const VALID_KEY = /^[^=\s]+$/

/**
 * Editor entries → `KEY=value` strings for /containers/create.
 * A null value means "keep whatever the container currently has" (secrets the
 * client never saw). Keys absent from `desired` are dropped — deletion works.
 */
export function mergeEnv(existing: string[], desired: { key: string; value: string | null }[]): string[] {
  const current = new Map<string, string>()
  for (const line of existing) {
    const eq = line.indexOf('=')
    current.set(eq === -1 ? line : line.slice(0, eq), eq === -1 ? '' : line.slice(eq + 1))
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const d of desired) {
    const key = String(d.key || '').trim()
    if (!VALID_KEY.test(key)) throw new Error(`invalid variable name: ${JSON.stringify(d.key)}`)
    if (seen.has(key)) throw new Error(`duplicate variable: ${key}`)
    seen.add(key)
    const value = d.value === null ? current.get(key) : d.value
    if (d.value === null && !current.has(key)) throw new Error(`"${key}" has no existing value to keep`)
    out.push(`${key}=${value ?? ''}`)
  }
  return out
}
