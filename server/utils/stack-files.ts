import {
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { safeRelPath, isProtectedPath, type FileEntry } from './files-core'
import type { ResolvedStack } from './stacks'

// Filesystem layer of the stack file browser. Every operation resolves the
// user path with safeRelPath (no `..`, no absolute paths) AND verifies the
// realpath stays inside the stack directory — a symlink placed in the dir
// can't be used as an escape hatch for reads or writes.

function stackRoot(stack: ResolvedStack): string {
  return realpathSync(stack.dir)
}

/** Resolve a validated relative path inside the stack; throws on escape. */
export function resolveInStack(stack: ResolvedStack, rel: string): { abs: string; rel: string } {
  const safe = safeRelPath(rel)
  if (safe === null) throw new Error('invalid path')
  if (isProtectedPath(safe)) throw new Error('.git internals are managed by homeport and not browsable')
  const root = stackRoot(stack)
  const abs = join(root, safe)
  // realpath containment: resolve the deepest existing ancestor and make sure
  // it is still inside the stack (covers symlinked parents); the final
  // component is additionally checked when it exists.
  let probe = abs
  while (!existsSync(probe)) probe = dirname(probe)
  const real = realpathSync(probe)
  if (real !== root && !real.startsWith(root + '/')) throw new Error('path escapes the stack directory')
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) {
    const target = realpathSync(abs)
    if (target !== root && !target.startsWith(root + '/')) throw new Error('symlink points outside the stack directory')
  }
  return { abs, rel: safe }
}

export function listStackFiles(stack: ResolvedStack, rel: string): { path: string; entries: FileEntry[] } {
  const { abs, rel: safe } = resolveInStack(stack, rel)
  const entries: FileEntry[] = []
  for (const d of readdirSync(abs, { withFileTypes: true })) {
    if (safe === '' && d.name === '.git') continue // hidden from the root listing
    try {
      const st = statSync(join(abs, d.name))
      entries.push({
        name: d.name,
        type: st.isDirectory() ? 'dir' : 'file',
        size: st.isDirectory() ? 0 : st.size,
        mtime: st.mtimeMs,
      })
    } catch {
      // broken symlink etc. — skip
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return { path: safe, entries }
}

export function readStackFile(stack: ResolvedStack, rel: string): { abs: string; rel: string; buf: Buffer } {
  const r = resolveInStack(stack, rel)
  if (!existsSync(r.abs) || !statSync(r.abs).isFile()) throw new Error('no such file')
  return { ...r, buf: readFileSync(r.abs) }
}

/** Atomic write (tmp + rename), keeping a single .bak of an overwritten file. */
export function writeStackFile(stack: ResolvedStack, rel: string, content: string | Buffer): void {
  const { abs } = resolveInStack(stack, rel)
  if (existsSync(abs) && !statSync(abs).isFile()) throw new Error('target is a directory')
  mkdirSync(dirname(abs), { recursive: true })
  if (existsSync(abs)) {
    try {
      renameSync(abs, `${abs}.bak`)
    } catch {
      // best-effort backup
    }
  }
  const tmp = join(dirname(abs), `.${basename(abs)}.tmp`)
  writeFileSync(tmp, content)
  renameSync(tmp, abs)
}

export function mkdirInStack(stack: ResolvedStack, rel: string): void {
  const { abs, rel: safe } = resolveInStack(stack, rel)
  if (!safe) throw new Error('invalid path')
  if (existsSync(abs)) throw new Error('already exists')
  mkdirSync(abs, { recursive: true })
}

export function deleteInStack(stack: ResolvedStack, rel: string): void {
  const { abs, rel: safe } = resolveInStack(stack, rel)
  if (!safe) throw new Error("refusing to delete the stack's root directory")
  if (safe === stack.file) throw new Error('this is the stack\'s compose file — delete the whole stack instead')
  if (!existsSync(abs)) throw new Error('no such file or directory')
  rmSync(abs, { recursive: true, force: true })
}

export function renameInStack(stack: ResolvedStack, rel: string, to: string): void {
  const from = resolveInStack(stack, rel)
  const dest = resolveInStack(stack, to)
  if (!from.rel || !dest.rel) throw new Error('invalid path')
  if (from.rel === stack.file) throw new Error("this is the stack's compose file — renaming it would orphan the stack")
  if (!existsSync(from.abs)) throw new Error('no such file or directory')
  if (existsSync(dest.abs)) throw new Error('target already exists')
  mkdirSync(dirname(dest.abs), { recursive: true })
  renameSync(from.abs, dest.abs)
}
