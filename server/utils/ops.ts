import { EventEmitter } from 'node:events'

// Tiny in-memory registry for long-running server operations (compose up/pull,
// image updates). POST endpoints start an op and return its id; the client then
// streams the buffered + live output over SSE (/api/ops/[id]). Single process —
// fits homeport's node-server model. Finished ops are kept briefly for late readers.

export interface Op {
  id: string
  title: string
  lines: string[]
  done: boolean
  ok: boolean | null
  startedAt: number
  emitter: EventEmitter
}

const ops = new Map<string, Op>()
const KEEP_DONE_MS = 10 * 60 * 1000
let counter = 0

function prune() {
  const now = Date.now()
  for (const [id, op] of ops) {
    if (op.done && now - op.startedAt > KEEP_DONE_MS) ops.delete(id)
  }
}

/** Start an operation; `run` reports progress via emit() and resolves ok/fail. */
export function startOp(title: string, run: (emit: (line: string) => void) => Promise<boolean>): string {
  prune()
  const id = `op${++counter}-${Date.now().toString(36)}`
  const op: Op = { id, title, lines: [], done: false, ok: null, startedAt: Date.now(), emitter: new EventEmitter() }
  op.emitter.setMaxListeners(20)
  ops.set(id, op)

  const emit = (line: string) => {
    op.lines.push(line)
    if (op.lines.length > 2000) op.lines.splice(0, op.lines.length - 2000)
    op.emitter.emit('line', line)
  }

  run(emit)
    .then((ok) => {
      op.done = true
      op.ok = ok
    })
    .catch((e) => {
      emit(`error: ${e?.message || e}`)
      op.done = true
      op.ok = false
    })
    .finally(() => op.emitter.emit('done'))

  return id
}

export function getOp(id: string): Op | undefined {
  return ops.get(id)
}
