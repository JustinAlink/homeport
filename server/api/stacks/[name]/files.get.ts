import { getConfig } from '../../../utils/config'
import { resolveStack } from '../../../utils/stacks'
import { listStackFiles } from '../../../utils/stack-files'
import { demoFileList } from '../../../utils/demo'

// List a directory inside a stack (file browser). Read-side of the browser is
// still gated on stacks — the files regularly contain secrets (.env).
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const path = String(getQuery(event).path || '')

  if (cfg.demo) return demoFileList(name, path)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await resolveStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  try {
    return listStackFiles(stack, path)
  } catch (e: any) {
    // A bind mount can point at a host path homeport can't see (its stacks dir is
    // a named volume, not a same-path mount) — surface that instead of raw ENOENT,
    // and point at the container file editor which reads it via the daemon.
    if (e?.code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        statusMessage:
          "homeport can't see this folder on disk — the app writes it to a host path outside homeport's stacks mount (common when the stacks dir is a named volume rather than a same-path host mount). Edit it from the stack's “Data & mounts” section, which reads it inside the container.",
      })
    }
    if (e?.code === 'EACCES') {
      throw createError({ statusCode: 403, statusMessage: 'permission denied reading this folder — try the container file editor in “Data & mounts”.' })
    }
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not list files' })
  }
})
