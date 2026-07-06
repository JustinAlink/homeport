import { readFileSync } from 'node:fs'
import { getConfig } from '../../../utils/config'
import { resolveStack, validateCompose } from '../../../utils/stacks'
import { writeStackFile, resolveInStack } from '../../../utils/stack-files'
import { demoFileWrite } from '../../../utils/demo'

// Save one file from the browser (atomic, keeps a .bak of the previous
// version). Saving the stack's compose file goes through the same validate-
// and-restore dance as the stack editor — an invalid compose file must never
// land on disk through a side door.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const body = await readBody<{ path?: string; content?: string }>(event)
  const path = String(body?.path || '')
  const content = body?.content
  if (!path || typeof content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Expected { path, content }' })
  }

  if (cfg.demo) return demoFileWrite(name, path, content)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await resolveStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  let rel: string
  let abs: string
  try {
    const r = resolveInStack(stack, path)
    rel = r.rel
    abs = r.abs
    writeStackFile(stack, path, content)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'save failed' })
  }

  if (rel === stack.file) {
    const check = await validateCompose(stack.name)
    if (!check.ok) {
      try {
        writeStackFile(stack, path, readFileSync(`${abs}.bak`, 'utf8'))
      } catch {
        // no backup — leave the invalid file for the user to fix
      }
      throw createError({ statusCode: 400, statusMessage: `compose validation failed:\n${check.output || 'unknown error'}` })
    }
  }
  return { ok: true, path: rel }
})
