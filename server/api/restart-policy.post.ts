import { getHosts } from '../utils/hosts'
import { getDockerFor, oneShot } from '../utils/docker'
import { getConfig } from '../utils/config'
import { demoSetRestartPolicy } from '../utils/demo'

const POLICIES = ['no', 'always', 'unless-stopped', 'on-failure'] as const
type Policy = (typeof POLICIES)[number]

// Change a container's restart policy in place (docker update — no recreate,
// no downtime). Same trust tier as start/stop: control capability + POST=1.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ id?: string; policy?: Policy }>(event)
  const id = String(body?.id || '')
  const policy = body?.policy
  if (!id || !policy || !POLICIES.includes(policy)) {
    throw createError({ statusCode: 400, statusMessage: `Expected { id, policy: ${POLICIES.join(' | ')} }` })
  }

  if (cfg.demo) return demoSetRestartPolicy(id, policy)
  if (!cfg.allowControl) {
    throw createError({ statusCode: 403, statusMessage: 'Controls are disabled (HOMEPORT_ALLOW_CONTROL=true to enable).' })
  }

  const sep = id.indexOf('::')
  const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
  const cid = sep >= 0 ? id.slice(sep + 2) : id
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })

  try {
    await getDockerFor(host)
      .getContainer(cid)
      .update({ RestartPolicy: { Name: policy, MaximumRetryCount: policy === 'on-failure' ? 3 : 0 }, ...oneShot() })
    return { ok: true, policy }
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: e?.message || 'update failed' })
  }
})
