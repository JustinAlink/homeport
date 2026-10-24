import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { listContainersFor } from '../utils/docker'
import { listAllStacks, externalProjects, stackOwner } from '../utils/stacks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stackStatuses, declaredServices, type DeclaredService } from '../utils/stacks-core'
import { isGitStack } from '../utils/git-stacks'
import { demoStackList } from '../utils/demo'

// List all manageable compose stacks — homeport's own stacks dir, the extra
// compose roots, and adopted external projects (running compose projects whose
// working_dir is visible in homeport's filesystem) — joined with live container
// state via the compose project label. Projects whose files homeport can't see
// stay "unmanaged" (visible + controllable, not editable); their workingDir is
// returned so the UI can say exactly what to mount. Gated behind
// HOMEPORT_ALLOW_STACKS.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return demoStackList()
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  // stacks operate on the primary host (the one DOCKER_HOST points at)
  let containers: Awaited<ReturnType<typeof listContainersFor>> = []
  try {
    containers = await listContainersFor(getHosts()[0])
  } catch {
    // host down — statuses default to stopped, no adoption
  }

  const all = listAllStacks(containers)
  const external = externalProjects(containers)
  // count from each compose file, so stopped (`down`) and never-started services show up too
  const declared: Record<string, DeclaredService[] | null> = {}
  const managedBy: Record<string, { by: string; url?: string } | null> = {}
  for (const a of all) {
    try {
      const content = readFileSync(join(a.dir, a.file), 'utf8')
      declared[a.name] = declaredServices(content)
      managedBy[a.name] = stackOwner(a.dir, content)
    } catch {
      declared[a.name] = null
      managedBy[a.name] = null
    }
  }
  const { stacks, unmanaged } = stackStatuses(all.map((a) => a.name), containers, declared)

  return {
    stacks: stacks.map((s) => {
      const ref = all.find((a) => a.name === s.name)!
      return {
        ...s,
        file: ref.file,
        source: ref.source,
        dir: ref.source === 'stacks' ? undefined : ref.dir,
        git: ref.source === 'stacks' && isGitStack(s.name),
        managedBy: managedBy[s.name]?.by,
        managedByUrl: managedBy[s.name]?.url,
      }
    }),
    unmanaged: unmanaged.map((u) => ({
      ...u,
      workingDir: external.find((e) => e.project === u.name)?.dir ?? null,
    })),
    dir: cfg.stacksDir,
    roots: cfg.composeRoots,
  }
})
