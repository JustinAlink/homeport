import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from '../../../utils/config'
import { getHosts } from '../../../utils/hosts'
import { resolveStack } from '../../../utils/stacks'
import { listMountsForProject } from '../../../utils/docker'
import { aggregateStackMounts } from '../../../utils/mounts-core'
import { demoStackMounts } from '../../../utils/demo'

// Where a stack's containers keep their files — named volumes, host binds, and
// config living inside the stack folder. Read-only discovery: makes an installed
// app's data locations visible when they sit OUTSIDE the compose file (the common
// case for auto-dockerized images, whose declared volumes become named volumes).
// Same stacks gate as the file browser — mount paths can hint at host layout.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')

  if (cfg.demo) return demoStackMounts(name)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  const stack = await resolveStack(name)
  const dir = stack?.dir ?? ''
  let perService: { service: string; mounts: any[] }[] = []
  try {
    perService = await listMountsForProject(getHosts()[0], name)
  } catch {
    // host down or no mount visibility — return nothing rather than error the page
  }

  const mounts = aggregateStackMounts(perService, dir)
  // A bind whose SOURCE path is under the stack dir is only actually editable in
  // the host file browser if homeport can READ it. When the stacks dir is a named
  // volume (not a same-path host mount), the daemon writes the bind on the host,
  // out of homeport's view — flag those so the UI routes them to the container
  // editor instead of deep-linking into a folder that ENOENTs.
  for (const m of mounts) {
    if (m.kind === 'bind-internal') m.hostVisible = !!dir && existsSync(join(dir, m.rel))
  }
  return { dir, mounts }
})
