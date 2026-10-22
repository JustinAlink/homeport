import { getConfig } from '../../utils/config'
import { saveStackValidated } from '../../utils/stacks'
import { demoStackSave } from '../../utils/demo'

// Save (or create with ?create=1) a stack's compose file. The saved file is
// validated with `docker compose config -q`; on failure the previous version is
// restored from the .bak and the validator's output returned as a 400.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const create = String(getQuery(event).create || '') === '1'
  const body = await readBody<{ content?: string }>(event)
  const content = body?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { content }' })
  }

  if (cfg.demo) return demoStackSave(name, content, create)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  let saved
  try {
    saved = await saveStackValidated(name, content, create)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'save failed' })
  }

  return { ok: true, stack: saved }
})
