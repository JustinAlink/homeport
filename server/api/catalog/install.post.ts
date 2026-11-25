import { getConfig } from '../../utils/config'
import { findApp } from '../../utils/catalog'
import { composeForInstall } from '../../utils/catalog-core'
import { newStackName } from '../../utils/stacks-core'
import { saveStackValidated, runStackOp, ComposeValidationError, StackNameTakenError } from '../../utils/stacks'
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

  const stackName = newStackName(String(body?.name || app.slug))
  if (!stackName) {
    throw createError({ statusCode: 400, statusMessage: 'invalid stack name (use lowercase letters, digits, - and _)' })
  }

  const gen = composeForInstall(app, inputs)
  if (!gen.ok) throw createError({ statusCode: 400, statusMessage: gen.errors.join('\n') })

  if (cfg.demo) return demoCatalogInstall(app, stackName, gen.content)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Installing needs stacks enabled (HOMEPORT_ALLOW_STACKS=true).' })
  }

  // create-only: refuses a name already in use (including a compose project
  // homeport can't read), and removes only the folder it created when the
  // generated file fails validation
  try {
    await saveStackValidated(stackName, gen.content, true)
  } catch (e: any) {
    if (e instanceof ComposeValidationError) {
      throw createError({ statusCode: 400, statusMessage: `generated compose failed validation:\n${e.output}` })
    }
    throw createError({ statusCode: e instanceof StackNameTakenError ? 409 : 400, statusMessage: e?.message || 'install failed' })
  }

  const opId = startOp(`install ${stackName}`, (emit) => runStackOp(stackName, 'up', emit))
  return { ok: true, stack: stackName, opId }
})
