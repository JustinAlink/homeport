import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getDockerFor } from '../utils/docker'
import { createDemuxer, createLineSplitter, splitTimestamp } from '../utils/logs-core'
import { demoLogLines } from '../utils/demo'

// Container logs. SSE stream of {s, t, line} JSON events (default), or a plain-
// text download with ?format=text&follow=0. Read-tier: on by default, can be
// disabled with HOMEPORT_LOGS=false.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.logsEnabled) {
    throw createError({ statusCode: 403, statusMessage: 'Logs are disabled (HOMEPORT_LOGS=false).' })
  }

  const q = getQuery(event)
  const id = String(q.id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing ?id' })
  const tail = Math.min(5000, Math.max(1, Number(q.tail) || 200))
  const follow = String(q.follow ?? '1') !== '0'
  const asText = String(q.format || '') === 'text'

  // demo mode — synthetic lines so the UI is fully usable without Docker
  if (cfg.demo) {
    if (asText) {
      setHeader(event, 'content-type', 'text/plain; charset=utf-8')
      setHeader(event, 'content-disposition', `attachment; filename="${id.replace(/[^a-z0-9_-]+/gi, '_')}.log"`)
      return demoLogLines(id, tail).map((l) => `${l.t} ${l.line}`).join('\n') + '\n'
    }
    const stream = createEventStream(event)
    for (const l of demoLogLines(id, Math.min(tail, 50))) stream.push(JSON.stringify(l))
    let n = 0
    const timer = follow
      ? setInterval(() => {
          const [l] = demoLogLines(id, 1, Date.now() + n++)
          stream.push(JSON.stringify(l))
        }, 1800)
      : null
    stream.onClosed(() => {
      if (timer) clearInterval(timer)
    })
    return stream.send()
  }

  // id is `${hostId}::${containerId}`
  const sep = id.indexOf('::')
  const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
  const containerId = sep >= 0 ? id.slice(sep + 2) : id
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw createError({ statusCode: 404, statusMessage: 'Unknown host' })
  const container = getDockerFor(host).getContainer(containerId)

  if (asText) {
    // one-shot: dockerode returns a Buffer when follow is false
    try {
      const buf = (await container.logs({ follow: false, stdout: true, stderr: true, tail, timestamps: true })) as unknown as Buffer
      const demux = createDemuxer()
      const text = demux.push(new Uint8Array(buf)).map((s) => s.text).join('')
      setHeader(event, 'content-type', 'text/plain; charset=utf-8')
      setHeader(event, 'content-disposition', `attachment; filename="${containerId.slice(0, 12)}.log"`)
      return text
    } catch (err: any) {
      throw createError({ statusCode: 502, statusMessage: `Could not read logs: ${err?.message || err}` })
    }
  }

  const stream = createEventStream(event)
  const demux = createDemuxer()
  const splitter = createLineSplitter()

  let dockerStream: NodeJS.ReadableStream | null = null
  try {
    // always follow on the SSE path — dockerode returns a Buffer (not a stream)
    // when follow is false, and a non-follow SSE has no use anyway
    dockerStream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })) as unknown as NodeJS.ReadableStream

    dockerStream.on('data', (chunk: Buffer) => {
      for (const seg of demux.push(new Uint8Array(chunk))) {
        for (const l of splitter.push(seg)) {
          const { t, line } = splitTimestamp(l.line)
          stream.push(JSON.stringify({ s: l.s, t, line }))
        }
      }
    })
    dockerStream.on('error', () => stream.push(JSON.stringify({ s: 'stderr', t: '', line: '— log stream error —' })))
    dockerStream.on('end', () => {
      for (const l of splitter.flush()) stream.push(JSON.stringify({ s: l.s, t: '', line: l.line }))
    })
  } catch (err: any) {
    stream.push(JSON.stringify({ s: 'stderr', t: '', line: `Could not open logs: ${err?.message || err}` }))
  }

  stream.onClosed(() => {
    try {
      ;(dockerStream as any)?.destroy?.()
    } catch {}
  })

  return stream.send()
})
