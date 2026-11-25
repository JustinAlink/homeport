import { getConfig } from '../../../utils/config'
import { startOp } from '../../../utils/ops'
import { runStackOp, selfProject } from '../../../utils/stacks'
import { safeStackName, type StackOp } from '../../../utils/stacks-core'
import { isGitStack } from '../../../utils/git-stacks'
import { startGitUpdate } from '../../../utils/git-webhooks'
import { ContainerBusyError } from '../../../utils/container-lock-core'
import { demoStackAction } from '../../../utils/demo'

const OPS: (StackOp | 'update')[] = ['up', 'down', 'restart', 'pull', 'update']

// Run a stack operation; returns an opId to stream from /api/ops/[id].
// 'update' (git stacks only): fetch + hard-reset to the remote branch head,
// then rebuild + recreate, which covers source-built projects, not just images. It
// shares one runner and one per-stack lock with deploy on push and auto-sync
// (git-webhooks.ts), so a click while a push is deploying gets a 409.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  const body = await readBody<{ op?: StackOp | 'update' }>(event)
  const op = body?.op
  if (!name || !op || !OPS.includes(op)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { op: up | down | restart | pull | update }' })
  }

  if (cfg.demo) return { opId: demoStackAction(name, op) }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  // Homeport's own stack: down/restart/pull would kill homeport mid-operation
  // and leave it half-applied ('up' on a running stack is a harmless no-op).
  if (op !== 'up' && name === (await selfProject())) {
    throw createError({
      statusCode: 400,
      statusMessage: `"${name}" is homeport's own stack: use the Update homeport button instead (sidebar, or Settings → Backup & about), since compose ${op} from inside would kill homeport mid-operation.`,
    })
  }

  if (op === 'update') {
    if (!isGitStack(name)) {
      throw createError({ statusCode: 400, statusMessage: 'update is only available for git-backed stacks' })
    }
    try {
      return { opId: startGitUpdate(name, 'manual').opId }
    } catch (e: any) {
      if (e instanceof ContainerBusyError) throw createError({ statusCode: 409, statusMessage: e.message })
      throw e
    }
  }

  const opId = startOp(`${op} ${name}`, (emit) => runStackOp(name, op as StackOp, emit))
  return { opId }
})
