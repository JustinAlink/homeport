// Pure, dependency-free logic for the in-container file browser (edit files that
// live inside a container or a named volume via `docker cp`). No fs/docker/tar
// I/O here — just path math + tar-entry interpretation, so it is unit-testable.
//
// A "container path" is an absolute POSIX path inside the container's filesystem
// (e.g. /etc/searxng/settings.yml). The browser is SCOPED to a root (a mount's
// destination) and must never resolve outside it.

import type { FileEntry } from './files-core'

/** Collapse `.`/`..`/duplicate slashes in an absolute container path. Returns
 *  null for anything not safe to touch (relative, null byte, backslash). */
export function normContainerPath(p: string): string | null {
  const raw = String(p ?? '')
  if (raw.includes('\0') || raw.includes('\\')) return null
  if (!raw.startsWith('/')) return null
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null // escapes above root
      out.pop()
      continue
    }
    if (seg.length > 255) return null
    out.push(seg)
  }
  return '/' + out.join('/')
}

export function baseName(p: string): string {
  const norm = (normContainerPath(p) ?? '/').replace(/\/+$/, '')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

export function parentPath(p: string): string {
  const norm = normContainerPath(p) ?? '/'
  if (norm === '/') return '/'
  const i = norm.lastIndexOf('/')
  return i <= 0 ? '/' : norm.slice(0, i)
}

/** Resolve a user-supplied relative path against a root, staying inside it.
 *  Returns the absolute container path, or null on escape / bad input. */
export function resolveInRoot(root: string, rel: string): string | null {
  const r = normContainerPath(root)
  if (r === null) return null
  const relRaw = String(rel ?? '')
  if (relRaw.includes('\0') || relRaw.includes('\\')) return null
  if (relRaw.startsWith('/')) return null // rel must be relative to the root
  const joined = normContainerPath(`${r}/${relRaw}`)
  if (joined === null) return null
  return joined === r || joined.startsWith(r === '/' ? '/' : r + '/') ? joined : null
}

/** true when `child` is `root` or lives under it. */
export function withinRoot(root: string, child: string): boolean {
  const r = normContainerPath(root)
  const c = normContainerPath(child)
  if (r === null || c === null) return false
  return c === r || c.startsWith(r === '/' ? '/' : r + '/')
}

export interface TarEntryHeader {
  name: string
  type: string // 'file' | 'directory' | 'symlink' | ...
  size: number
  mtimeMs: number
}

/**
 * Docker's `GET .../archive?path=<dir>` returns a tar whose top-level entry is
 * the requested dir's BASE NAME (e.g. archiving /etc/searxng → entries
 * `searxng/`, `searxng/settings.yml`, `searxng/sub/`, `searxng/sub/x`). Turn the
 * raw tar headers into a one-level listing of that directory.
 */
export function listingFromTarEntries(entries: TarEntryHeader[], archiveBase: string): FileEntry[] {
  const prefix = archiveBase.replace(/\/+$/, '') + '/'
  const byName = new Map<string, FileEntry>()
  for (const e of entries) {
    const name = e.name.replace(/^\.?\//, '') // some daemons prefix `./`
    if (!name.startsWith(prefix)) continue
    const rest = name.slice(prefix.length).replace(/\/+$/, '')
    if (rest === '') continue // the archived dir itself
    const slash = rest.indexOf('/')
    const first = slash === -1 ? rest : rest.slice(0, slash)
    // a deeper path (`sub/x`) implies `sub` is a directory even if the daemon
    // didn't emit a standalone dir entry; keep the dir classification if seen.
    const existing = byName.get(first)
    const isDir = slash !== -1 || e.type === 'directory' || existing?.type === 'dir'
    byName.set(first, {
      name: first,
      type: isDir ? 'dir' : 'file',
      size: isDir ? 0 : e.size,
      mtime: existing?.mtime ?? e.mtimeMs,
    })
  }
  return [...byName.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

// Go's os.FileMode bits, as they arrive in the base64 X-Docker-Container-Path-Stat
// header. Only the two we care about.
const MODE_DIR = 0x80000000 // 1<<31
const MODE_SYMLINK = 0x8000000 // 1<<27

export interface ContainerPathStat {
  name: string
  size: number
  isDir: boolean
  isSymlink: boolean
  linkTarget: string
}

/** Decode the base64 JSON in the `X-Docker-Container-Path-Stat` header. */
export function parsePathStat(headerB64: string | null | undefined): ContainerPathStat | null {
  if (!headerB64) return null
  try {
    const json = JSON.parse(Buffer.from(String(headerB64), 'base64').toString('utf8'))
    const mode = Number(json.mode) >>> 0
    return {
      name: String(json.name ?? ''),
      size: Number(json.size ?? 0),
      isDir: (mode & MODE_DIR) !== 0,
      isSymlink: (mode & MODE_SYMLINK) !== 0,
      linkTarget: String(json.linkTarget ?? ''),
    }
  } catch {
    return null
  }
}
