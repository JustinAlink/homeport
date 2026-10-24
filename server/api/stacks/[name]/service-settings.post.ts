import { getConfig } from '../../../utils/config'
import { readStack, saveStackValidated, stackManagedBy } from '../../../utils/stacks'
import { patchComposeService, type ServiceSettingsPatch } from '../../../utils/compose-edit-core'
import { managedByOf } from '../../../utils/stacks-core'
import { isGitStack } from '../../../utils/git-stacks'
import { demoStackRead, demoStackSave, demoSwitchTag, demoIsGitStack } from '../../../utils/demo'

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

  // A git-backed stack's folder is hard-reset to the repository on every update
  // from git, so an edit here would be silently undone: refuse (fail closed).
  if (cfg.demo ? demoIsGitStack(name) : isGitStack(name)) {
    throw createError({
      statusCode: 409,
      statusMessage: `"${name}" is deployed from git: its compose file is replaced on every update from git, so make this change in the repository instead.`,
    })
  }

  const current = cfg.demo ? demoStackRead(name) : await readStack(name)
  if (!current) throw createError({ statusCode: 404, statusMessage: `stack "${name}" not found` })

  // owned by another system (x-homeport.managed-by, in the file or an override
  // compose loads): its next run would overwrite this
  const owner = cfg.demo || !('dir' in current) || !current.dir ? managedByOf(current.content) : stackManagedBy(current.dir, current.content)
  if (owner) {
    throw createError({
      statusCode: 409,
      statusMessage: `"${name}"'s compose file is managed by ${owner}: its next run would overwrite this change, so make it there instead.`,
    })
  }

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
