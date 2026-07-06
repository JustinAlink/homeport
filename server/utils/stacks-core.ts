// Pure, dependency-free compose-stack logic — unit-testable in isolation.

/** Compose file pick order inside a stack directory (Dockge/compose convention). */
export const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']

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

export interface StackStatus {
  name: string
  state: StackState
  running: number
  total: number
}

/**
 * Join stack dirs with running containers via the compose project label
 * (Service.project / com.docker.compose.project). Containers whose project has
 * no stack dir are "unmanaged" (started elsewhere — visible but not editable).
 */
export function stackStatuses(
  stackNames: string[],
  containers: { project: string | null; state: string }[],
): { stacks: StackStatus[]; unmanaged: { name: string; running: number; total: number }[] } {
  const byProject = new Map<string, { running: number; total: number }>()
  for (const c of containers) {
    if (!c.project) continue
    const e = byProject.get(c.project) || { running: 0, total: 0 }
    e.total++
    if (c.state === 'running' || c.state === 'restarting') e.running++
    byProject.set(c.project, e)
  }

  const stacks: StackStatus[] = stackNames.map((name) => {
    const e = byProject.get(name)
    if (!e || e.total === 0) return { name, state: 'stopped' as const, running: 0, total: e?.total ?? 0 }
    const state: StackState = e.running === 0 ? 'stopped' : e.running === e.total ? 'running' : 'partial'
    return { name, state, running: e.running, total: e.total }
  })

  const known = new Set(stackNames)
  const unmanaged = [...byProject.entries()]
    .filter(([p]) => !known.has(p))
    .map(([name, e]) => ({ name, ...e }))
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
