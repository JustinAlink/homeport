import { getOp } from '../../utils/ops'

// SSE stream of an operation's output: replays buffered lines, follows live ones,
// then sends a final `done` event with the ok flag and closes.
export default defineEventHandler((event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const op = getOp(id)
  if (!op) throw createError({ statusCode: 404, statusMessage: 'Unknown operation' })

  const stream = createEventStream(event)
  let cursor = 0

  const flush = () => {
    while (cursor < op.lines.length) {
      stream.push(JSON.stringify({ line: op.lines[cursor++] }))
    }
  }
  const finish = () => {
    flush()
    stream.push(JSON.stringify({ done: true, ok: op.ok }))
  }

  flush()
  if (op.done) {
    finish()
  } else {
    const onLine = () => flush()
    const onDone = () => finish()
    op.emitter.on('line', onLine)
    op.emitter.on('done', onDone)
    stream.onClosed(() => {
      op.emitter.off('line', onLine)
      op.emitter.off('done', onDone)
    })
  }

  return stream.send()
})
