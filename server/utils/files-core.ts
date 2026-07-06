// Pure, dependency-free stack-file-browser logic — unit-testable in isolation.
// Everything here exists to keep the browser INSIDE the stack directory.

/**
 * Validate a user-supplied relative path. Returns the normalized form
 * ('' = the stack root) or null for anything that could escape: absolute
 * paths, backslashes, null bytes, `.`/`..` segments, empty segments.
 */
export function safeRelPath(p: string): string | null {
  const raw = String(p ?? '').trim()
  if (raw === '' || raw === '/') return ''
  if (raw.includes('\0') || raw.includes('\\')) return null
  if (raw.startsWith('/') || raw.endsWith('/')) return null
  const segments = raw.split('/')
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') return null
    if (s.length > 255) return null
  }
  return segments.join('/')
}

/** Paths the browser must never touch — git internals (tokens, integrity). */
export function isProtectedPath(rel: string): boolean {
  return rel === '.git' || rel.startsWith('.git/')
}

/** Cheap binary sniff: a null byte in the head means "not text — download it". */
export function looksBinary(head: Uint8Array): boolean {
  const n = Math.min(head.length, 8192)
  for (let i = 0; i < n; i++) if (head[i] === 0) return true
  return false
}

/** Cap for in-browser text editing; larger files are download-only. */
export const MAX_EDIT_BYTES = 1024 * 1024
/** Cap for uploads through the browser. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface FileEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}
