// Pure compose-stack logic (no fs, no docker), unit-testable in isolation.

import { parseYAML } from 'confbox/yaml'

/** Compose file pick order inside a stack directory (Dockge/compose convention). */
export const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']
/** Override files `docker compose` loads on its own next to the main file. */
export const COMPOSE_OVERRIDE_FILENAMES = ['compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yml', 'docker-compose.override.yaml']

export function findComposeFile(filenames: string[]): string | null {
  for (const want of COMPOSE_FILENAMES) {
    if (filenames.includes(want)) return want
  }
  return null
}

/**
 * Stack names come from user-controlled URLs and become filesystem paths and
 * compose project names — allow only a conservative charset, no traversal.
 */
export function safeStackName(name: string): string | null {
  const n = String(name || '').trim()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(n)) return null
  return n
}

export type StackState = 'running' | 'partial' | 'stopped'

/** A service as declared in a compose file. `optional` = behind a profile, so not started by default. */
export interface DeclaredService {
  name: string
  image?: string
  optional: boolean
}

/**
 * The services a compose file declares. Counting a stack from its file (not from
 * whichever containers happen to exist) is what keeps a stack visible after
 * `down` and makes "3/3 running" honest when a fourth service never started.
 * null when the file can't be read as YAML (callers fall back to containers).
 */
export function declaredServices(content: string): DeclaredService[] | null {
  let doc: any
  try {
    doc = parseYAML(content)
  } catch {
    return null
  }
  const services = doc?.services
  if (!services || typeof services !== 'object' || Array.isArray(services)) return null
  return Object.entries(services).map(([name, def]: [string, any]) => ({
    name,
    image: typeof def?.image === 'string' ? def.image : undefined,
    optional: Array.isArray(def?.profiles) && def.profiles.length > 0,
  }))
}

/**
 * Who owns this compose file, when it isn't homeport. A top-level extension field
 * (compose ignores every `x-` key) declares it:
 *
 *   x-homeport:
 *     managed-by: juniperserver playbook
 *
 * homeport then never writes the file itself (its next run would overwrite the
 * change, like an update from git does) and warns before a hand edit.
 */
export function managedByOf(content: string): string | null {
  let doc: any
  try {
    doc = parseYAML(content)
  } catch {
    return null
  }
  const by = doc?.['x-homeport']?.['managed-by']
  if (typeof by !== 'string' || !by.trim()) return null
  return by.trim().slice(0, 120)
}

/**
 * The owner named by the main compose file or, failing that, by an override file
 * compose loads next to it. The override matters when the main file belongs to
 * someone else's updater (mailcow's `update.sh` rewrites docker-compose.yml, so the
 * marker can only live in docker-compose.override.yml). Missing files are null.
 */
export function managedByOfFiles(main: string | null, overrides: (string | null)[]): string | null {
  for (const content of [main, ...overrides]) {
    const by = content == null ? null : managedByOf(content)
    if (by) return by
  }
  return null
}

export interface StackStatus {
  name: string
  state: StackState
  running: number
  total: number
  /** declared (non-profile) services that have no container at all */
  missing: { name: string; image?: string }[]
}

/**
 * Join stack dirs with running containers via the compose project label
 * (Service.project / com.docker.compose.project). Containers whose project has
 * no stack dir are "unmanaged" (started elsewhere — visible but not editable).
 */
export function stackStatuses(
  stackNames: string[],
  containers: { project: string | null; state: string; service?: string | null }[],
  declared: Record<string, DeclaredService[] | null> = {},
): { stacks: StackStatus[]; unmanaged: { name: string; running: number; total: number }[] } {
  const byProject = new Map<string, { running: number; total: number; services: Set<string> }>()
  for (const c of containers) {
    if (!c.project) continue
    const e = byProject.get(c.project) || { running: 0, total: 0, services: new Set<string>() }
    e.total++
    if (c.state === 'running' || c.state === 'restarting') e.running++
    if (c.service) e.services.add(c.service)
    byProject.set(c.project, e)
  }

  const stacks: StackStatus[] = stackNames.map((name) => {
    const e = byProject.get(name) || { running: 0, total: 0, services: new Set<string>() }
    // declared services with no container count towards the total as "not running"
    const missing = (declared[name] ?? [])
      .filter((d) => !d.optional && !e.services.has(d.name))
      .map((d) => ({ name: d.name, ...(d.image ? { image: d.image } : {}) }))
    const total = e.total + missing.length
    const state: StackState = e.running === 0 ? 'stopped' : e.running === total ? 'running' : 'partial'
    return { name, state, running: e.running, total, missing }
  })

  const known = new Set(stackNames)
  const unmanaged = [...byProject.entries()]
    .filter(([p]) => !known.has(p))
    .map(([name, e]) => ({ name, running: e.running, total: e.total }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { stacks, unmanaged }
}

/** Where a stack's compose file lives: homeport's own stacks dir, an extra
 * configured compose root, or adopted in place from a running project's
 * com.docker.compose.project.working_dir label. */
export type StackSource = 'stacks' | 'root' | 'adopted'

export interface ExternalProject {
  project: string
  dir: string
  /** Absolute compose file paths from the config_files label (may be empty). */
  files: string[]
}

/** Extract an external compose project's on-disk location from container labels. */
export function externalProjectFromLabels(labels: Record<string, string>): ExternalProject | null {
  const project = labels['com.docker.compose.project']
  const dir = labels['com.docker.compose.project.working_dir']
  if (!project || !dir || !dir.startsWith('/')) return null
  const files = (labels['com.docker.compose.project.config_files'] || '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.startsWith('/'))
  return { project, dir, files }
}

/** Compose's default project name for a directory (lowercase, invalid chars dropped). */
export function projectNameFromDir(dirName: string): string | null {
  const n = dirName.toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[_-]+/, '')
  return n || null
}

/** Top-level `name:` from a compose file, if present (cheap scan, no YAML parse). */
export function composeProjectNameFromContent(content: string): string | null {
  const m = /^name:\s*["']?([a-z0-9][a-z0-9_-]*)["']?\s*(#.*)?$/m.exec(content)
  return m ? m[1] : null
}

export type StackOp = 'up' | 'down' | 'restart' | 'pull'

/** docker compose argv for an operation (after `docker compose -p <name>`). */
export function composeArgs(op: StackOp): string[][] {
  switch (op) {
    case 'up':
      return [['up', '-d', '--remove-orphans']]
    case 'down':
      return [['down']]
    case 'restart':
      return [['restart']]
    case 'pull': // pull then recreate with the fresh images
      return [['pull'], ['up', '-d', '--remove-orphans']]
  }
}
