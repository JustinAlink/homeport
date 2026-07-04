import { getConfig } from '../../../utils/config'
import { startOp } from '../../../utils/ops'
import { runCompose, runStackOp } from '../../../utils/stacks'
import { safeStackName, type StackOp } from '../../../utils/stacks-core'
import { isGitStack, updateGitStack } from '../../../utils/git-stacks'
import { demoStackAction } from '../../../utils/demo'

const OPS: (StackOp | 'update')[] = ['up', 'down', 'restart', 'pull', 'update']

// Run a stack operation; returns an opId to stream from /api/ops/[id].
// 'update' (git stacks only): fetch + hard-reset to the remote branch head,
// then rebuild + recreate — covers source-built projects, not just images.
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

  if (op === 'update') {
    if (!isGitStack(name)) {
      throw createError({ statusCode: 400, statusMessage: 'update is only available for git-backed stacks' })
    }
    const opId = startOp(`update ${name}`, async (emit) => {
      if (!(await updateGitStack(name, emit))) return false
      emit(`$ docker compose -p ${name} up -d --build --remove-orphans`)
      const { code } = await runCompose(name, ['up', '-d', '--build', '--remove-orphans'], emit)
      if (code !== 0) {
        emit(`✗ exited with code ${code}`)
        return false
      }
      emit('✓ done')
      return true
    })
    return { opId }
  }

  const opId = startOp(`${op} ${name}`, (emit) => runStackOp(name, op as StackOp, emit))
  return { opId }
})
