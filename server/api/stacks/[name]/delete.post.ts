import { getConfig } from '../../../utils/config'
import { readStack, runStackOp, deleteStackDir } from '../../../utils/stacks'
import { deleteToken } from '../../../utils/git-stacks'
import { startOp } from '../../../utils/ops'
import { safeStackName } from '../../../utils/stacks-core'
import { demoStackDelete } from '../../../utils/demo'

// Delete a managed stack: compose down, then remove its directory (and git
// token). Streamed as an op like every other stack operation. Named volumes
// are left alone — data outlives the stack unless removed explicitly.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Invalid stack name' })

  if (cfg.demo) return { opId: demoStackDelete(name) }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  if (!readStack(name)) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  const opId = startOp(`delete ${name}`, async (emit) => {
    const ok = await runStackOp(name, 'down', emit)
    if (!ok) {
      emit('compose down failed — stack directory NOT removed')
      return false
    }
    deleteStackDir(name)
    deleteToken(name)
    emit(`removed stack directory for "${name}" (named volumes kept)`)
    return true
  })
  return { opId }
})
