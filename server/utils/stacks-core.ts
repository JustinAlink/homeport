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
