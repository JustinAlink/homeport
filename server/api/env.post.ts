import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { splitServiceId } from '../utils/service-id'
import { mergeEnv } from '../utils/env-core'
import { applyEnvChange } from '../utils/updates'
import { demoEnvApply } from '../utils/demo'

// Apply an edited environment: merge (null values keep the existing secret),
// then recreate the container in place — same swap machinery as image updates.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ id?: string; env?: { key: string; value: string | null }[] }>(event)
  const id = body?.id
  if (!id || !Array.isArray(body?.env)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { id, env: [{ key, value }] }' })
  }

  if (cfg.demo) {
    await new Promise((r) => setTimeout(r, 1200))
    return { ok: true, steps: demoEnvApply(id, body.env!) }
  }
  if (!cfg.allowUpdates) {
    throw createError({ statusCode: 403, statusMessage: 'Environment editing needs the updates capability (HOMEPORT_ALLOW_UPDATES=true).' })
  }

  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  let env: string[]
  try {
    const inspect: any = await getDockerFor(host).getContainer(containerId).inspect(oneShot())
    env = mergeEnv(inspect?.Config?.Env ?? [], body.env!)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'invalid environment' })
  }

  try {
    const { steps, newId } = await applyEnvChange(host, containerId, env)
    return { ok: true, steps, newId }
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: err?.message || 'env change failed',
      data: { steps: err?.steps },
    })
  }
})
