import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from '../../utils/config'
import { findApp } from '../../utils/catalog'
import { composeForInstall } from '../../utils/catalog-core'
import { safeStackName } from '../../utils/stacks-core'
import { readStack, saveStack, validateCompose, runStackOp } from '../../utils/stacks'
import { startOp } from '../../utils/ops'
import { demoCatalogInstall } from '../../utils/demo'

// Install a catalog app: resolve inputs → generate compose → create a stack →
// `compose up` as a streamed op. The result is a normal stack, editable on
// /stacks/<name> like any hand-written one.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ slug?: string; name?: string; inputs?: Record<string, unknown> }>(event)
  const slug = String(body?.slug || '')
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>

  const app = await findApp(slug)
  if (!app) throw createError({ statusCode: 404, statusMessage: 'unknown catalog app' })

  const stackName = safeStackName(String(body?.name || app.slug))
  if (!stackName) {
    throw createError({ statusCode: 400, statusMessage: 'invalid stack name (use letters, digits, - and _)' })
  }

  const gen = composeForInstall(app, inputs)
  if (!gen.ok) throw createError({ statusCode: 400, statusMessage: gen.errors.join('\n') })

  if (cfg.demo) return demoCatalogInstall(app, stackName, gen.content)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Installing needs stacks enabled (HOMEPORT_ALLOW_STACKS=true).' })
  }

  if (await readStack(stackName)) {
    throw createError({ statusCode: 409, statusMessage: `a stack named "${stackName}" already exists` })
  }

  await saveStack(stackName, gen.content, true)
  const check = await validateCompose(stackName)
  if (!check.ok) {
    // fresh install — remove the just-created dir so a corrected retry starts clean
    try {
      rmSync(join(cfg.stacksDir, stackName), { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
    throw createError({ statusCode: 400, statusMessage: `generated compose failed validation:\n${check.output || 'unknown error'}` })
  }

  const opId = startOp(`install ${stackName}`, (emit) => runStackOp(stackName, 'up', emit))
  return { ok: true, stack: stackName, opId }
})
