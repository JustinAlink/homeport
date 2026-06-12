import { readFileSync } from 'node:fs'
import { getConfig } from '../../utils/config'
import { saveStack, validateCompose } from '../../utils/stacks'
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
    saved = saveStack(name, content, create)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'save failed' })
  }

  const check = await validateCompose(saved.name)
  if (!check.ok) {
    // restore the previous good version from .bak — backup:false so we don't
    // overwrite that good .bak with the rejected content.
    try {
      const good = readFileSync(`${cfg.stacksDir}/${saved.name}/${saved.file}.bak`, 'utf8')
      saveStack(saved.name, good, false, false)
    } catch {
      // no backup (new stack) — leave the invalid file for the user to fix
    }
    throw createError({ statusCode: 400, statusMessage: `compose validation failed:\n${check.output || 'unknown error'}` })
  }

  return { ok: true, stack: saved }
})
