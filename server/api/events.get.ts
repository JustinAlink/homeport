import { getEventStreamFor } from '../utils/docker'
import { getHosts } from '../utils/hosts'
import { getConfig } from '../utils/config'
import { log } from '../utils/log'

// SSE: push a "refresh" whenever any host reports a container change, plus a
// periodic heartbeat. The client re-fetches /api/services on each.
//
// The upstream docker event stream can die quietly (socket-proxy restart, host
// blip) — each host reattaches with exponential backoff for as long as the SSE
// client is connected, and pushes one "refresh" on reattach to catch up.
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000

export default defineEventHandler(async (event) => {
  setHeader(event, 'X-Accel-Buffering', 'no') // don't let nginx/NPM buffer the SSE stream
  const stream = createEventStream(event)

  let closed = false
  const streams = new Set<NodeJS.ReadableStream>()
  const timers = new Set<NodeJS.Timeout>()

  async function attach(host: any, firstTry: boolean, backoff = RETRY_BASE_MS) {
    if (closed) return
    try {
      const ds = await getEventStreamFor(host)
      streams.add(ds)
      if (!firstTry) stream.push('refresh') // catch up on whatever happened during the outage

      let gone = false
      const reattach = () => {
        if (gone) return // 'error' and 'end' can both fire
        gone = true
        streams.delete(ds)
        scheduleRetry(host, RETRY_BASE_MS) // stream worked — restart the backoff ladder
      }
      ds.on('data', () => stream.push('refresh'))
      ds.on('error', reattach)
      ds.on('end', reattach)
    } catch (e) {
      // Log the first failed attach per host — an endless silent reconnect loop
      // (e.g. socket-proxy missing EVENTS=1) is why "the dashboard never goes live".
      if (firstTry) log.warn('events', `docker event stream unavailable for host "${host?.name ?? host?.id ?? '?'}" — live updates fall back to polling`, e)
      scheduleRetry(host, Math.min(backoff * 2, RETRY_MAX_MS))
    }
  }

  function scheduleRetry(host: any, nextBackoff: number) {
    if (closed || getConfig().demo) return // demo: no docker to reattach to
    const t = setTimeout(() => {
      timers.delete(t)
      attach(host, false, nextBackoff)
    }, nextBackoff)
    timers.add(t)
  }

  for (const host of getHosts()) attach(host, true)

  const heartbeat = setInterval(() => stream.push('ping'), 25_000)
  stream.onClosed(() => {
    closed = true
    clearInterval(heartbeat)
    for (const t of timers) clearTimeout(t)
    for (const ds of streams) {
      try {
        ;(ds as any)?.destroy?.()
      } catch {}
    }
  })

  return stream.send()
})
