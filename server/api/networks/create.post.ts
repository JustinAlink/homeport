import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { createNetworkFor } from '../../utils/networks'
import { demoNetworkCreate } from '../../utils/demo'

// Create a bridge network (optionally with a fixed subnet). The subnet is
// validated and checked for overlaps up front so errors are actionable.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ name?: string; subnet?: string }>(event)
  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Expected { name, subnet? }' })

  if (cfg.demo) return demoNetworkCreate(name, String(body?.subnet || '').trim())
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  try {
    await createNetworkFor(getHosts()[0], { name, subnet: body?.subnet })
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not create the network' })
  }
  return { ok: true }
})
