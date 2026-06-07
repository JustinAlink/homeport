import { getEventStream } from '../utils/docker'

// Server-Sent Events: push a "refresh" whenever Docker reports a container
// change, plus a periodic heartbeat. The client re-fetches /api/services on each.
export default defineEventHandler(async (event) => {
  const stream = createEventStream(event)
  let dockerStream: NodeJS.ReadableStream | null = null

  try {
    dockerStream = await getEventStream()
    dockerStream.on('data', () => stream.push('refresh'))
    dockerStream.on('error', () => {})
  } catch {
    // Docker events unavailable — client still polls as a fallback.
  }

  const heartbeat = setInterval(() => stream.push('ping'), 25_000)

  stream.onClosed(() => {
    clearInterval(heartbeat)
    try {
      ;(dockerStream as any)?.destroy?.()
    } catch {}
  })

  return stream.send()
})
