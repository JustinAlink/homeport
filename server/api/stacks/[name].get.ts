import { getConfig } from '../../utils/config'
import { readStack } from '../../utils/stacks'
import { demoStackRead } from '../../utils/demo'

// Read one stack's compose file.
export default defineEventHandler((event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  if (cfg.demo) {
    const s = demoStackRead(name)
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })
    return s
  }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = readStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })
  return stack
})
