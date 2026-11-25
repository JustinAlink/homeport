import { getConfig } from '../../utils/config'
import { composeFromImage, serviceNameFromImage, type PortMapping } from '../../utils/autostack-core'
import { newStackName } from '../../utils/stacks-core'
import { saveStackValidated, runStackOp, ComposeValidationError, StackNameTakenError } from '../../utils/stacks'
import { startOp } from '../../utils/ops'
import { demoCatalogInstall } from '../../utils/demo'

// Auto-dockerize a Docker Hub image: generate a compose stack from the image's
// declared ports/volumes (as confirmed/edited on the install form), then
// create + `up` it — the twin of /api/catalog/install for arbitrary images.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{
    image?: string
    name?: string
    ports?: { container?: unknown; host?: unknown }[]
    volumes?: unknown[]
  }>(event)

  const raw = String(body?.image || '').trim().slice(0, 200)
  if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/.test(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid image reference' })
  }
  const image = raw.includes(':') ? raw : `${raw}:latest`

  const stackName = newStackName(String(body?.name || serviceNameFromImage(image)))
  if (!stackName) {
    throw createError({ statusCode: 400, statusMessage: 'invalid stack name (use lowercase letters, digits, - and _)' })
  }

  const okPort = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535
  const ports: PortMapping[] = (Array.isArray(body?.ports) ? body.ports : [])
    .slice(0, 20)
    .map((p) => ({ container: Number(p?.container), host: Number(p?.host) }))
    .filter((p) => okPort(p.container) && okPort(p.host))
  const volumes = (Array.isArray(body?.volumes) ? body.volumes : [])
    .slice(0, 20)
    .map((v) => String(v ?? ''))
    .filter((v) => v.startsWith('/') && !/[\s:'"]/.test(v))

  const content = composeFromImage(image, { ports, volumes })

  if (cfg.demo) return demoCatalogInstall({ name: stackName, image }, stackName, content)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Installing needs stacks enabled (HOMEPORT_ALLOW_STACKS=true).' })
  }
  // create-only, same rules as a catalog install (see there)
  try {
    await saveStackValidated(stackName, content, true)
  } catch (e: any) {
    if (e instanceof ComposeValidationError) {
      throw createError({ statusCode: 400, statusMessage: `generated compose failed validation:\n${e.output}` })
    }
    throw createError({ statusCode: e instanceof StackNameTakenError ? 409 : 400, statusMessage: e?.message || 'install failed' })
  }

  const opId = startOp(`install ${stackName}`, (emit) => runStackOp(stackName, 'up', emit))
  return { ok: true, stack: stackName, opId }
})
