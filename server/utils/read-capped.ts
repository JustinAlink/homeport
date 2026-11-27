import type { H3Event } from 'h3'

/**
 * A request body, byte for byte, refusing anything past `max` while it streams
 * in. The Content-Length check alone is not enough: a chunked body has none, and
 * h3's readRawBody would buffer all of it before anyone could look at the size.
 */
export async function readCapped(event: H3Event, max: number): Promise<Buffer> {
  if (Number(getHeader(event, 'content-length') || 0) > max) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    size += chunk.length
    if (size > max) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
