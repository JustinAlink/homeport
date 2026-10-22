// Runs a compose operation on a stack (up / restart / pull / down / update) and
// resolves when it finishes, streaming nothing to the caller: the dashboard just
// needs "busy", a toast, and fresh data afterwards. The stack page keeps its own
// streaming log view.
export type StackOpName = 'up' | 'restart' | 'pull' | 'down' | 'update'

const VERB: Record<StackOpName, [string, string]> = {
  up: ['Starting', 'started'],
  restart: ['Restarting', 'restarted'],
  pull: ['Updating', 'updated'],
  update: ['Updating', 'updated from git'],
  down: ['Stopping', 'stopped'],
}

export function useStackOp() {
  const busy = useState<Record<string, StackOpName>>('hp:stack-busy', () => ({}))
  const toast = useToast()
  const services = useServices()
  const stacks = useStacks()
  const updates = useUpdates()

  async function run(name: string, op: StackOpName): Promise<boolean> {
    if (busy.value[name]) return false
    busy.value = { ...busy.value, [name]: op }
    let ok = false
    let lastLine = ''
    try {
      const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(name)}/action`, { method: 'POST', body: { op } })
      ok = await new Promise<boolean>((resolve) => {
        const es = new EventSource(`/api/ops/${opId}`)
        es.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.line) lastLine = msg.line
            if (msg.done) {
              es.close()
              resolve(msg.ok !== false)
            }
          } catch {}
        }
        // a dropped stream doesn't mean a failed op: it keeps running server-side
        es.onerror = () => {
          es.close()
          resolve(true)
        }
      })
      if (ok) toast.success(`Stack ${name} ${VERB[op][1]}`)
      else toast.error(`Stack ${name}: ${op} failed${lastLine ? `\n${lastLine}` : ''}`)
    } catch (e: any) {
      toast.error(errMsg(e, `Could not ${op} stack ${name}`))
    } finally {
      const next = { ...busy.value }
      delete next[name]
      busy.value = next
      await Promise.all([services.refresh(), stacks.refresh(), op === 'pull' || op === 'update' ? updates.refresh() : null])
    }
    return ok
  }

  const label = (name: string) => (busy.value[name] ? VERB[busy.value[name]][0] : '')
  return { busy, run, label }
}
