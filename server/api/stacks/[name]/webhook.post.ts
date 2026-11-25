import { getConfig } from '../../../utils/config'
import { safeStackName } from '../../../utils/stacks-core'
import { isGitStack } from '../../../utils/git-stacks'
import { validSigningKey } from '../../../utils/git-webhooks-core'
import {
  createHook,
  hasHook,
  isSelfStack,
  regenerateSecret,
  removeHook,
  setAutoSync,
  setSigningKey,
  webhookView,
} from '../../../utils/git-webhooks'
import { demoIsGitStack } from '../../../utils/demo'

type Op = 'create' | 'regenerate' | 'remove' | 'signing-key' | 'auto-sync'
const OPS: Op[] = ['create', 'regenerate', 'remove', 'signing-key', 'auto-sync']

// Change a stack's deploy-on-push settings. `create` and `regenerate` answer
// with the secret: the only two responses that ever carry it.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  const body = await readBody<{ op?: Op; signingKey?: string; enabled?: boolean; intervalMin?: number }>(event)
  const op = body?.op
  if (!name || !op || !OPS.includes(op)) {
    throw createError({ statusCode: 400, statusMessage: `Expected { op: ${OPS.join(' | ')} }` })
  }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const git = cfg.demo ? demoIsGitStack(name) : isGitStack(name)
  if (!git) throw createError({ statusCode: 400, statusMessage: 'Deploy on push needs a stack that was deployed from a git repository.' })
  const self = !cfg.demo && (await isSelfStack(name))
  if (self && op !== 'remove') {
    throw createError({
      statusCode: 400,
      statusMessage: `"${name}" is homeport's own stack: it never updates itself from git (it would stop itself halfway). Use Update homeport instead.`,
    })
  }
  const needHooks = () => {
    if (!cfg.allowGitWebhooks) {
      throw createError({ statusCode: 403, statusMessage: 'Git webhooks are turned off (Settings, Capabilities, or HOMEPORT_ALLOW_GIT_WEBHOOKS=true).' })
    }
  }
  const needHook = () => {
    if (!hasHook(name)) throw createError({ statusCode: 404, statusMessage: 'This stack has no webhook yet.' })
  }

  let secret: string | undefined
  switch (op) {
    case 'create':
      needHooks()
      if (hasHook(name)) throw createError({ statusCode: 409, statusMessage: 'This stack already has a webhook: regenerate its secret instead.' })
      secret = createHook(name)
      break
    case 'regenerate':
      needHooks()
      needHook()
      secret = regenerateSecret(name)
      break
    case 'remove':
      removeHook(name) // allowed with webhooks off too: cleaning up never needs the capability
      break
    case 'signing-key': {
      needHooks()
      needHook()
      const raw = String(body?.signingKey ?? '').trim()
      const key = raw ? validSigningKey(raw) : null
      if (raw && !key) {
        throw createError({ statusCode: 400, statusMessage: 'That is not a GitLab signing token (it starts with whsec_). The secret token goes in GitLab, not here.' })
      }
      setSigningKey(name, key)
      break
    }
    case 'auto-sync':
      setAutoSync(name, !!body?.enabled, body?.intervalMin)
      break
  }
  return { ...webhookView(name, { git, self }), ...(secret ? { secret } : {}) }
})
