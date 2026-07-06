import { formatLine, levelEnabled, parseLevel, type LogLevel } from './log-core'

// Server-side logger — the ONE place homeport writes diagnostics. Console-based
// (Docker captures stdout/stderr → `docker logs homeport`), zero dependencies.
// Level via HOMEPORT_LOG_LEVEL (debug|info|warn|error|silent, default info).
// Every line is `<ISO> LEVEL [tag] message — <error>` so `docker logs | grep`
// on a subsystem tag ([collector], [alerts], [self-update], …) is useful.
//
// NEVER pass secrets as the message/error — redactLog is a safety net, not a
// license (registry tokens, session secrets, passwords stay out entirely).

const threshold: LogLevel = parseLevel(process.env.HOMEPORT_LOG_LEVEL, 'info')

function emit(level: Exclude<LogLevel, 'silent'>, tag: string, message: string, err?: unknown): void {
  if (!levelEnabled(threshold, level)) return
  const line = formatLine(new Date().toISOString(), level, tag, message, err)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (tag: string, message: string, err?: unknown) => emit('debug', tag, message, err),
  info: (tag: string, message: string, err?: unknown) => emit('info', tag, message, err),
  warn: (tag: string, message: string, err?: unknown) => emit('warn', tag, message, err),
  error: (tag: string, message: string, err?: unknown) => emit('error', tag, message, err),
  /** The configured threshold — for a one-time boot line. */
  level: threshold,
}

/**
 * Log a degraded-mode fallback AT MOST ONCE per key (so a per-tick fallback like
 * "history not writable" doesn't spam every collector cycle).
 */
const warnedOnce = new Set<string>()
export function warnOnce(key: string, tag: string, message: string, err?: unknown): void {
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  log.warn(tag, message, err)
}
