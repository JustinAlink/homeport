import { getConfig } from '../../../utils/config'
import { safeStackName } from '../../../utils/stacks-core'
import { isGitStack } from '../../../utils/git-stacks'
import { isSelfStack, webhookView } from '../../../utils/git-webhooks'
import { demoIsGitStack } from '../../../utils/demo'

// Deploy-on-push settings for one stack: webhook URL (never its secret), the
// auto-sync interval, and the last delivery and check. Admin only: read-scope
// tokens and viewers are kept out (api-tokens-core READ_DENY_PATTERNS), since
// the URL is half of what a sender needs.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  if (!name) throw createError({ statusCode: 400, statusMessage: 'invalid stack name' })
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  if (cfg.demo) return webhookView(name, { git: demoIsGitStack(name), self: false })
  const git = isGitStack(name)
  return webhookView(name, { git, self: git && (await isSelfStack(name)) })
})
