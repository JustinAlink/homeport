// Pure planning/scheduling logic for automatic updates — unit-testable in isolation.
//
// Opt-in model: a container is auto-updated when its name or compose project is
// in the configured target list, or it carries the label `hub.autoupdate=true`.
// The label `hub.autoupdate=false` always opts out, even if targeted. homeport's
// own container is always skipped (recreating it would kill the updater — the
// self-update helper exists for that). So is the rest of homeport's own compose
// project: in the standard deployment that holds the docker-socket-proxy
// homeport and compose reach the daemon THROUGH, and recreating it mid-run
// severs that transport (the 2026-08-05 incident; see buildHelperPayload).

export interface AutoCandidate {
  id: string
  name: string
  image: string
  project: string | null
  labels: Record<string, string>
}

export interface AutoPlan {
  /** Managed stacks to update via `compose pull && up` (covers all their containers). */
  stacks: string[]
  /** Containers to update via direct pull + recreate. */
  directs: AutoCandidate[]
  skipped: { name: string; reason: 'self' | 'self-project' | 'label-optout' }[]
}

/** Fire once per local day, in the configured hour. */
export function isAutoUpdateDue(nowHour: number, cfgHour: number, lastDay: string | undefined, todayKey: string): boolean {
  return nowHour === cfgHour && lastDay !== todayKey
}

export function planAutoUpdate(opts: {
  candidates: AutoCandidate[] // containers that HAVE an update available
  targets: string[] // stack/project or container names
  managedStacks: string[]
  selfIdPrefix?: string
  /** homeport's own compose project: nothing in it is updated unattended */
  selfProject?: string | null
}): AutoPlan {
  const targets = new Set(opts.targets.map((t) => t.trim()).filter(Boolean))
  const plan: AutoPlan = { stacks: [], directs: [], skipped: [] }
  const stackSet = new Set<string>()

  for (const c of opts.candidates) {
    const label = (c.labels['hub.autoupdate'] || '').toLowerCase()
    if (label === 'false') {
      plan.skipped.push({ name: c.name, reason: 'label-optout' })
      continue
    }
    const opted = label === 'true' || targets.has(c.name) || (c.project !== null && targets.has(c.project))
    if (!opted) continue
    if (opts.selfIdPrefix && c.id.startsWith(opts.selfIdPrefix)) {
      plan.skipped.push({ name: c.name, reason: 'self' })
      continue
    }
    if (opts.selfProject && c.project === opts.selfProject) {
      plan.skipped.push({ name: c.name, reason: 'self-project' })
      continue
    }
    if (c.project && opts.managedStacks.includes(c.project)) stackSet.add(c.project)
    else plan.directs.push(c)
  }

  plan.stacks = [...stackSet].sort()
  return plan
}
