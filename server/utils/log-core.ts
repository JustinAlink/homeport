// Pure logging logic — level thresholds, error serialization, secret redaction,
// line formatting. No console/fs/env — unit-testable in isolation. The thin
// runtime wrapper (log.ts) reads the env level and writes to console.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

// Ascending severity; 'silent' is a threshold only (nothing is ever emitted AT it).
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

/** Parse HOMEPORT_LOG_LEVEL; anything unrecognised falls back (default 'info'). */
export function parseLevel(raw: unknown, fallback: LogLevel = 'info'): LogLevel {
  const v = String(raw ?? '').trim().toLowerCase()
  return (v in ORDER ? v : fallback) as LogLevel
}

/** Should a message AT `level` be emitted given the configured `threshold`? */
export function levelEnabled(threshold: LogLevel, level: Exclude<LogLevel, 'silent'>): boolean {
  return ORDER[level] >= ORDER[threshold]
}

/** Human-readable one-liner for any thrown value (never throws, never dumps a stack). */
export function serializeError(e: unknown): string {
  if (e == null) return ''
  if (typeof e === 'string') return e
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    return code !== undefined && code !== null ? `${e.message} (${String(code)})` : e.message
  }
  const msg = (e as { message?: unknown }).message
  if (typeof msg === 'string' && msg) return msg
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

/**
 * Strip credentials that must never reach the log: `user:pass@host` in URLs,
 * and the value side of token/password/secret/authorization key=value pairs.
 * Defence-in-depth — callers should already avoid logging secrets.
 */
export function redactLog(text: string): string {
  return String(text ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1***@')
    .replace(/\b(authorization|token|password|passwd|secret|api[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',]+)/gi, '$1$2***')
}

/**
 * Format a log line: `<ISO> LEVEL [tag] message — <error>`. The timestamp is
 * passed in (the runtime supplies it) so this stays pure and testable.
 */
export function formatLine(iso: string, level: Exclude<LogLevel, 'silent'>, tag: string, message: string, err?: unknown): string {
  const errPart = err === undefined ? '' : ` — ${serializeError(err)}`
  const line = `${iso} ${level.toUpperCase()} [${tag}] ${message}${errPart}`
  return redactLog(line)
}
