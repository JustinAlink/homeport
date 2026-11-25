import { resolveAdmin } from './resolve'

// Delete reverse-proxy routes pointing at containers that are being removed —
// the "also clean up NPM" half of a full delete. Best-effort by design: a
// missing/disabled proxy admin becomes a note, never a failed delete.

export async function deleteRoutesForUpstreams(upstreams: string[], emit: (line: string) => void, hostId?: string): Promise<void> {
  let admin: ReturnType<typeof resolveAdmin>
  try {
    // The proxy of the host the container lived on. Without the id this is the
    // first host's proxy, which on a multi-host setup deleted another machine's
    // live routes for a container that merely shared the name.
    admin = resolveAdmin(hostId)
  } catch (e: any) {
    emit(`proxy cleanup skipped: ${e?.message || e}`)
    return
  }
  try {
    const routes = (await admin.listRoutes()).filter((r) => upstreams.includes(r.upstreamHost))
    if (!routes.length) {
      emit('proxy cleanup: no routes point at this upstream')
      return
    }
    if (!admin.capabilities.delete) {
      emit(`proxy cleanup skipped: ${admin.name} cannot delete routes`)
      return
    }
    for (const r of routes) {
      try {
        await admin.deleteRoute(r.id)
        emit(`removed proxy route ${r.domains.join(', ')} → ${r.upstreamHost}:${r.upstreamPort}`)
      } catch (e: any) {
        emit(`could not remove proxy route ${r.domains.join(', ')}: ${e?.message || e}`)
      }
    }
  } catch (e: any) {
    emit(`proxy cleanup failed: ${e?.message || e}`)
  }
}
