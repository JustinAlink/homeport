import { getConfig } from '../../../utils/config'
import { resolveStack } from '../../../utils/stacks'
import { mkdirInStack, deleteInStack, renameInStack } from '../../../utils/stack-files'
import { demoFileAction } from '../../../utils/demo'

const ACTIONS = ['mkdir', 'delete', 'rename'] as const
type Action = (typeof ACTIONS)[number]

// File-browser mutations that aren't content writes: new folder, delete,
// rename/move. The stack's compose file and .git are protected in the fs layer.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const body = await readBody<{ action?: Action; path?: string; to?: string }>(event)
  const action = body?.action
  const path = String(body?.path || '')
  const to = String(body?.to || '')
  if (!action || !ACTIONS.includes(action) || !path || (action === 'rename' && !to)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { action: mkdir|delete|rename, path, to? }' })
  }

  if (cfg.demo) return demoFileAction(name, action, path, to)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await resolveStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  try {
    if (action === 'mkdir') mkdirInStack(stack, path)
    else if (action === 'delete') deleteInStack(stack, path)
    else renameInStack(stack, path, to)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || `${action} failed` })
  }
  return { ok: true }
})
