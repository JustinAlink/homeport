import { getConfig } from '../../../utils/config'
import { startOp } from '../../../utils/ops'
import { runStackOp } from '../../../utils/stacks'
import { safeStackName, type StackOp } from '../../../utils/stacks-core'
import { demoStackAction } from '../../../utils/demo'

const OPS: StackOp[] = ['up', 'down', 'restart', 'pull']

// Run a stack operation; returns an opId to stream from /api/ops/[id].
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  const body = await readBody<{ op?: StackOp }>(event)
  const op = body?.op
  if (!name || !op || !OPS.includes(op)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { op: up | down | restart | pull }' })
  }

  if (cfg.demo) return { opId: demoStackAction(name, op) }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  const opId = startOp(`${op} ${name}`, (emit) => runStackOp(name, op, emit))
  return { opId }
})
