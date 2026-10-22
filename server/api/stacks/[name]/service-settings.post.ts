import { getConfig } from '../../../utils/config'
import { readStack, saveStackValidated } from '../../../utils/stacks'
import { patchComposeService, type ServiceSettingsPatch } from '../../../utils/compose-edit-core'
import { demoStackRead, demoStackSave, demoSwitchTag } from '../../../utils/demo'

// Write one service's restart policy, CPU / memory limits, network membership
// or image version into the stack's compose file, so a change made live (docker
// update / network connect) survives the next `compose up`, and a version switch
// is a one-line edit the next `compose up` applies. Comments and formatting are kept (compose-edit-core), and the
// result is validated with `docker compose config` like any editor save.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const body = await readBody<{ service?: string } & ServiceSettingsPatch>(event)
  const service = String(body?.service || '')
  if (!service) throw createError({ statusCode: 400, statusMessage: 'Expected { service, restart?, cpus?, memory?, addNetwork?, removeNetwork?, tag? }' })
  const patch: ServiceSettingsPatch = {}
  if (body.restart !== undefined) patch.restart = body.restart
  if (body.cpus !== undefined) patch.cpus = body.cpus == null ? null : Number(body.cpus)
  if (body.memory !== undefined) patch.memory = body.memory
  if (typeof body.addNetwork === 'string' && body.addNetwork) patch.addNetwork = body.addNetwork
  if (typeof body.removeNetwork === 'string' && body.removeNetwork) patch.removeNetwork = body.removeNetwork
  if (typeof body.tag === 'string' && body.tag) patch.tag = body.tag.trim()

  if (!cfg.demo && !cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }

  const current = cfg.demo ? demoStackRead(name) : await readStack(name)
  if (!current) throw createError({ statusCode: 404, statusMessage: `stack "${name}" not found` })

  let next: string
  try {
    next = patchComposeService(current.content, service, patch)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not edit the compose file' })
  }
  if (next === current.content) return { ok: true, changed: false, file: current.file }

  if (cfg.demo) {
    demoStackSave(name, next, false)
    if (patch.tag) demoSwitchTag(service, patch.tag)
    return { ok: true, changed: true, file: current.file }
  }
  try {
    const saved = await saveStackValidated(name, next)
    return { ok: true, changed: true, file: saved.file }
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'save failed' })
  }
})
