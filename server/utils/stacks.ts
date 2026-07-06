import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs'
import { join, basename, dirname, isAbsolute, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { listContainersFor } from './docker'
import { listNetworksFor } from './networks'
import {
  findComposeFile,
  safeStackName,
  composeArgs,
  externalProjectFromLabels,
  projectNameFromDir,
  composeProjectNameFromContent,
  type StackOp,
  type StackSource,
  type ExternalProject,
} from './stacks-core'
import { detectNetworkError, findSubnetConflicts, subnetsFromComposeConfig } from './networks-core'

// Compose stacks come from three places, in resolution priority order:
//   1. HOMEPORT_STACKS_DIR subdirs (dirname = project name) — homeport's own,
//      creatable/deletable here; git-backed stacks live here too.
//   2. Extra compose roots (settings composeRoots / HOMEPORT_COMPOSE_ROOTS):
//      each subdir with a compose file is a managed stack IN PLACE — mount the
//      host directory at the SAME path so relative binds resolve correctly
//      (same rule as the self-update helper).
//   3. Adopted projects: running compose projects whose
//      com.docker.compose.project.working_dir is visible in homeport's fs.
// Operations shell out to the docker compose CLI (bundled in the image), which
// honors DOCKER_HOST and therefore the socket proxy. ssh:// hosts unsupported.

export interface ResolvedStack {
  /** Compose project name — the stack's identity in URLs and `-p`. */
  name: string
  dir: string
  /** Primary (editable) compose filename, relative to dir. */
  file: string
  /** Explicit -f args (adopted stacks with nonstandard filenames). */
  files?: string[]
  source: StackSource
}

export interface StackFile {
  name: string
  file: string // compose filename within the dir
  content: string
  source: StackSource
  dir: string
}

const stacksDir = () => getConfig().stacksDir

function scanDir(root: string, source: StackSource, nameFor: (dirName: string, dir: string, file: string) => string | null): ResolvedStack[] {
  const out: ResolvedStack[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const entry of entries) {
    const dir = join(root, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
      const file = findComposeFile(readdirSync(dir))
      if (!file) continue
      const name = nameFor(entry, dir, file)
      if (!name || !safeStackName(name)) continue
      out.push({ name, dir, file, source })
    } catch {
      // unreadable entry — skip
    }
  }
  return out
}

export function listStackDirs(): ResolvedStack[] {
  return scanDir(stacksDir(), 'stacks', (dirName) => (safeStackName(dirName) ? dirName : null)).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/**
 * Stacks under the extra compose roots. Project name resolution: a running
 * container whose working_dir label matches the dir wins (authoritative), then
 * a top-level `name:` in the compose file, then compose's default (the dir name).
 */
export function listRootStacks(external: ExternalProject[]): ResolvedStack[] {
  const cfg = getConfig()
  const byDir = new Map(external.map((e) => [e.dir, e.project]))
  const out: ResolvedStack[] = []
  for (const root of cfg.composeRoots) {
    if (!isAbsolute(root) || root === stacksDir()) continue
    out.push(
      ...scanDir(root, 'root', (dirName, dir, file) => {
        const labeled = byDir.get(dir)
        if (labeled) return labeled
        try {
          const fromFile = composeProjectNameFromContent(readFileSync(join(dir, file), 'utf8'))
          if (fromFile) return fromFile
        } catch {
          // unreadable — fall through to the default name
        }
        return projectNameFromDir(dirName)
      }),
    )
  }
  return out
}

/** External projects (from container labels), deduped by project name. */
export function externalProjects(containers: { labels: Record<string, string> }[]): ExternalProject[] {
  const byProject = new Map<string, ExternalProject>()
  for (const c of containers) {
    const e = externalProjectFromLabels(c.labels)
    if (e && !byProject.has(e.project)) byProject.set(e.project, e)
  }
  return [...byProject.values()]
}

/** Adopt an external project in place if its compose file is visible to us. */
function adoptExternal(e: ExternalProject): ResolvedStack | null {
  if (!safeStackName(e.project)) return null
  try {
    if (!statSync(e.dir).isDirectory()) return null
  } catch {
    return null
  }
  const visible = e.files.filter((f) => existsSync(f))
  if (visible.length) {
    const primary = visible[0]
    const rel = (f: string) => (dirname(f) === e.dir ? basename(f) : relative(e.dir, f))
    return { name: e.project, dir: e.dir, file: rel(primary), files: visible.map(rel), source: 'adopted' }
  }
  // no usable config_files label — fall back to the standard names in the dir
  try {
    const file = findComposeFile(readdirSync(e.dir))
    if (file) return { name: e.project, dir: e.dir, file, source: 'adopted' }
  } catch {
    // unreadable
  }
  return null
}

/** All manageable stacks, deduped by project name (stacks dir > roots > adopted). */
export function listAllStacks(containers: { labels: Record<string, string> }[]): ResolvedStack[] {
  const external = externalProjects(containers)
  const out = new Map<string, ResolvedStack>()
  for (const s of listStackDirs()) out.set(s.name, s)
  for (const s of listRootStacks(external)) if (!out.has(s.name)) out.set(s.name, s)
  for (const e of external) {
    if (out.has(e.project)) continue
    const adopted = adoptExternal(e)
    if (adopted) out.set(adopted.name, adopted)
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Resolve one stack by project name (cheap local scans first, docker last). */
export async function resolveStack(name: string): Promise<ResolvedStack | null> {
  const safe = safeStackName(name)
  if (!safe) return null

  const local = listStackDirs().find((s) => s.name === safe)
  if (local) return local

  let containers: { labels: Record<string, string> }[] = []
  try {
    containers = await listContainersFor(getHosts()[0])
  } catch {
    // host down — roots still resolvable without label hints
  }
  return listAllStacks(containers).find((s) => s.name === safe) ?? null
}

/** Compose project of homeport's own container (null when not containerized). */
export async function selfProject(): Promise<string | null> {
  try {
    const short = hostname()
    const containers = await listContainersFor(getHosts()[0])
    return containers.find((c) => c.id.startsWith(short))?.project ?? null
  } catch {
    return null
  }
}

/** Remove a stack's directory entirely (after compose down). Stacks-dir only. */
export function deleteStackDir(name: string): void {
  const safe = safeStackName(name)
  if (!safe) throw new Error('invalid stack name')
  rmSync(join(stacksDir(), safe), { recursive: true, force: true })
}

export async function readStack(name: string): Promise<StackFile | null> {
  const s = await resolveStack(name)
  if (!s) return null
  try {
    return { name: s.name, file: s.file, content: readFileSync(join(s.dir, s.file), 'utf8'), source: s.source, dir: s.dir }
  } catch {
    return null
  }
}

/**
 * Atomic save (tmp + rename) keeping a single .bak of the previous version.
 * New stacks are always created under the stacks dir; existing ones (including
 * external/adopted) are edited in place. Pass backup=false when restoring a
 * known-good version (so the rejected content doesn't overwrite the good .bak).
 */
export async function saveStack(name: string, content: string, createNew = false, backup = true): Promise<StackFile> {
  const safe = safeStackName(name)
  if (!safe) throw new Error('invalid stack name (use letters, digits, - and _)')

  let dir: string
  let file: string
  let source: StackSource = 'stacks'
  const existing = await resolveStack(safe)
  if (existing) {
    dir = existing.dir
    file = existing.file
    source = existing.source
  } else {
    if (!createNew) throw new Error('stack not found')
    dir = join(stacksDir(), safe)
    mkdirSync(dir, { recursive: true })
    file = 'compose.yaml'
  }

  const target = join(dir, file)
  if (backup && existsSync(target)) {
    try {
      renameSync(target, `${target}.bak`)
    } catch {
      // best-effort backup
    }
  }
  const tmp = join(dir, `.${file}.tmp`)
  writeFileSync(tmp, content)
  renameSync(tmp, target)
  return { name: safe, file, content, source, dir }
}

/** Env for the compose CLI: route it at the same daemon homeport watches. */
export function composeEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig()
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (cfg.dockerHost.startsWith('ssh://')) {
    throw new Error('Stacks are not supported on ssh:// Docker hosts (run homeport on that host instead).')
  }
  if (cfg.dockerHost) env.DOCKER_HOST = cfg.dockerHost
  else delete env.DOCKER_HOST // local socket (DOCKER_SOCKET default path)
  return env
}

/** Spawn `docker compose -p <name> <args>` in the stack dir, streaming output lines. */
export async function runCompose(
  name: string,
  args: string[],
  emit: (line: string) => void,
): Promise<{ code: number }> {
  const stack = await resolveStack(name)
  if (!stack) throw new Error('unknown stack')

  const env = composeEnv()

  // adopted stacks with nonstandard filenames need explicit -f flags; standard
  // names are left to compose's own discovery (which also picks up overrides)
  const fileArgs = stack.files?.length && !['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].includes(stack.file)
    ? stack.files.flatMap((f) => ['-f', f])
    : []

  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '-p', stack.name, ...fileArgs, ...args], { cwd: stack.dir, env })
    let buf = ''
    const onChunk = (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) if (line.trim()) emit(line.trimEnd())
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (e) =>
      reject(new Error(e.message.includes('ENOENT') ? 'docker CLI not found in the homeport image/host' : e.message)),
    )
    child.on('close', (code) => {
      if (buf.trim()) emit(buf.trimEnd())
      resolve({ code: code ?? 1 })
    })
  })
}

/** Validate a compose file by running `docker compose config -q` against it. */
export function validateCompose(name: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const lines: string[] = []
    runCompose(name, ['config', '-q'], (l) => lines.push(l))
      .then(({ code }) => resolve({ ok: code === 0, output: lines.join('\n') }))
      .catch((e) => resolve({ ok: false, output: e?.message || String(e) }))
  })
}

/** Subnets this stack's compose config asks for (empty on any failure). */
async function requestedSubnets(name: string): Promise<string[]> {
  try {
    const lines: string[] = []
    const { code } = await runCompose(name, ['config', '--format', 'json'], (l) => lines.push(l))
    if (code !== 0) return []
    return subnetsFromComposeConfig(JSON.parse(lines.join('\n')))
  } catch {
    return []
  }
}

/**
 * Best-effort diagnosis when a compose run fails on docker network address
 * space problems — names the conflicting network instead of leaving the user
 * with a bare "Pool overlaps" (a real support case: an upstream compose file
 * pinned a subnet another stack already occupied).
 */
async function emitNetworkHints(name: string, output: string, emit: (line: string) => void): Promise<void> {
  const kind = detectNetworkError(output)
  if (!kind) return
  try {
    const networks = await listNetworksFor(getHosts()[0])
    if (kind === 'overlap') {
      const conflicts = findSubnetConflicts(await requestedSubnets(name), networks)
      for (const c of conflicts) {
        emit(
          `⚠ this stack requests subnet ${c.requested}, which overlaps existing network "${c.network}" (${c.subnet}${
            c.containers ? `, used by ${c.containers} container${c.containers > 1 ? 's' : ''}` : ', unused'
          })`,
        )
      }
      if (!conflicts.length) emit('⚠ a network this stack defines overlaps an existing docker network')
      emit('→ fix: change the subnet under networks/ipam in the compose file, or remove the conflicting network below if it is unused')
    } else {
      emit('⚠ docker has no free address pools left for a new network (too many existing networks)')
      const unused = networks.filter((n) => !n.builtin && n.containers === 0)
      if (unused.length) emit(`→ unused networks that could be removed: ${unused.map((n) => n.name).join(', ')}`)
    }
  } catch {
    // hints are best-effort — never mask the original failure
  }
}

/** Run a stack operation (up/down/restart/pull) as a streamed op. */
export async function runStackOp(name: string, op: StackOp, emit: (line: string) => void): Promise<boolean> {
  for (const args of composeArgs(op)) {
    emit(`$ docker compose -p ${name} ${args.join(' ')}`)
    const lines: string[] = []
    const capture = (l: string) => {
      lines.push(l)
      emit(l)
    }
    const { code } = await runCompose(name, args, capture)
    if (code !== 0) {
      emit(`✗ exited with code ${code}`)
      await emitNetworkHints(name, lines.join('\n'), emit)
      return false
    }
  }
  emit('✓ done')
  return true
}
