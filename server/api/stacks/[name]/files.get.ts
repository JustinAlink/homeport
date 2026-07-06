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
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not list files' })
  }
})
