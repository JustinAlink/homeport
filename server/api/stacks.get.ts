import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { listContainersFor } from '../utils/docker'
import { listStackDirs } from '../utils/stacks'
import { stackStatuses } from '../utils/stacks-core'
import { demoStackList } from '../utils/demo'

// List compose stacks (dirs under HOMEPORT_STACKS_DIR) joined with live container
// state via the compose project label, plus "unmanaged" projects (running compose
// projects with no stack dir). Gated behind HOMEPORT_ALLOW_STACKS.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return demoStackList()
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  const dirs = listStackDirs()

  // stacks operate on the primary host (the one DOCKER_HOST points at)
  let containers: { project: string | null; state: string }[] = []
  try {
    containers = await listContainersFor(getHosts()[0])
  } catch {
    // host down — statuses default to stopped
  }

  const { stacks, unmanaged } = stackStatuses(dirs.map((d) => d.name), containers)
  return {
    stacks: stacks.map((s) => ({ ...s, file: dirs.find((d) => d.name === s.name)?.file })),
    unmanaged,
    dir: cfg.stacksDir,
  }
})
