import { getConfig } from '../../../utils/config'
import { safeStackName } from '../../../utils/stacks-core'
import { gitStackMeta, checkBehind } from '../../../utils/git-stacks'
import { demoGitMeta } from '../../../utils/demo'

// Git metadata for a stack: remote, branch, HEAD, and whether the remote
// branch has moved (?check=1 bypasses the 60s ls-remote cache).
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  if (!name) throw createError({ statusCode: 400, statusMessage: 'invalid stack name' })

  if (cfg.demo) return demoGitMeta(name)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  const meta = await gitStackMeta(name)
  if (!meta) return { git: false }

  const force = String(getQuery(event).check || '') === '1'
  const { behind, remoteCommit } = await checkBehind(name, force)
  return { git: true, ...meta, behind, remoteCommit }
})
