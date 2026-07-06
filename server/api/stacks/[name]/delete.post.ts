import { getConfig } from '../../../utils/config'
import { getHosts } from '../../../utils/hosts'
import { listContainersFor } from '../../../utils/docker'
import { readStack, runCompose, deleteStackDir } from '../../../utils/stacks'
import { listNetworksFor, removeNetworkFor } from '../../../utils/networks'
import { leftoverProjectNetworks } from '../../../utils/networks-core'
import { deleteRoutesForUpstreams } from '../../../utils/proxy-admin/cleanup'
import { deleteToken } from '../../../utils/git-stacks'
import { startOp } from '../../../utils/ops'
import { safeStackName } from '../../../utils/stacks-core'
import { demoStackDelete } from '../../../utils/demo'

// Delete a managed stack: compose down, then remove its directory (and git
// token). Streamed as an op like every other stack operation. By default named
// volumes are left alone — data outlives the stack unless `volumes` is set.
// Optional full cleanup: `images` removes the stack's images, `proxyRoutes`
// deletes reverse-proxy routes pointing at its containers, and leftover
// project networks are swept always (unused ones caused real "Pool overlaps"
// failures on reinstall). External stacks (compose roots / adopted projects)
// are refused — homeport won't delete files it doesn't own.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = safeStackName(String(getRouterParam(event, 'name') || ''))
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Invalid stack name' })
  const body = await readBody<{ volumes?: boolean; images?: boolean; proxyRoutes?: boolean }>(event).catch(() => null)
  const opts = { volumes: !!body?.volumes, images: !!body?.images, proxyRoutes: !!body?.proxyRoutes }

  if (cfg.demo) return { opId: demoStackDelete(name, opts) }
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await readStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })
  if (stack.source !== 'stacks') {
    throw createError({
      statusCode: 403,
      statusMessage: `"${name}" lives outside homeport's stacks directory (${stack.dir}) — take it down and remove its files there instead.`,
    })
  }

  // container names captured up front — gone from the daemon after `down`
  let upstreams: string[] = []
  if (opts.proxyRoutes) {
    try {
      upstreams = (await listContainersFor(getHosts()[0])).filter((c) => c.project === name).map((c) => c.name)
    } catch {
      // host down — the proxy cleanup step reports finding nothing
    }
  }

  const opId = startOp(`delete ${name}`, async (emit) => {
    const args = ['down', '--remove-orphans']
    if (opts.volumes) args.push('--volumes')
    if (opts.images) args.push('--rmi', 'all')
    emit(`$ docker compose -p ${name} ${args.join(' ')}`)
    const { code } = await runCompose(name, args, emit)
    if (code !== 0) {
      emit(`✗ exited with code ${code}`)
      emit('compose down failed — stack directory NOT removed')
      return false
    }

    // sweep leftover project networks (external/manually-created ones survive
    // `down` and their claimed subnets break later installs)
    try {
      for (const n of leftoverProjectNetworks(await listNetworksFor(getHosts()[0]), name)) {
        await removeNetworkFor(getHosts()[0], n.name)
        emit(`removed leftover network ${n.name}${n.subnets.length ? ` (${n.subnets.join(', ')})` : ''}`)
      }
    } catch (e: any) {
      emit(`network sweep skipped: ${e?.message || e}`)
    }

    if (opts.proxyRoutes) await deleteRoutesForUpstreams(upstreams, emit)

    deleteStackDir(name)
    deleteToken(name)
    emit(`removed stack directory for "${name}"${opts.volumes ? '' : ' (named volumes kept)'}`)
    return true
  })
  return { opId }
})
