import { getEventStreamFor } from '../utils/docker'
import { getHosts } from '../utils/hosts'

// SSE: push a "refresh" whenever any host reports a container change, plus a
// periodic heartbeat. The client re-fetches /api/services on each.
export default defineEventHandler(async (event) => {
  const stream = createEventStream(event)
  const dockerStreams: NodeJS.ReadableStream[] = []

  for (const host of getHosts()) {
    try {
      const ds = await getEventStreamFor(host)
      ds.on('data', () => stream.push('refresh'))
      ds.on('error', () => {})
      dockerStreams.push(ds)
    } catch {
      // host events unavailable — client still polls as a fallback
    }
  }

  const heartbeat = setInterval(() => stream.push('ping'), 25_000)
  stream.onClosed(() => {
    clearInterval(heartbeat)
    for (const ds of dockerStreams) {
      try {
        ;(ds as any)?.destroy?.()
      } catch {}
    }
  })

  return stream.send()
})
