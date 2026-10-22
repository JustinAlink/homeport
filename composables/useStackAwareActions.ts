import type { Service } from '~/types/service'

// Container actions that know about stacks. Stopping or deleting one container
// of a managed stack is allowed, but the dialog says what will happen (the
// stack's next start brings it back) and offers the stack-level action instead.
export function useStackAwareActions() {
  const { confirm, choose } = useConfirm()
  const stacks = useStacks()
  const stackOp = useStackOp()
  const { data } = useServices()

  /** The managed stack a container belongs to (stacks live on the primary host), or null. */
  function stackOf(s: Service | undefined | null): string | null {
    if (!s || s.kind !== 'container' || !s.project) return null
    const primary = data.value?.hosts?.[0]?.name
    if (s.host && primary && s.host !== primary) return null
    return stacks.isManaged(s.project) ? s.project : null
  }

  /** Resolves true when the caller should stop just this container. */
  async function confirmStop(s: Service): Promise<boolean> {
    const stack = stackOf(s)
    if (!stack) return confirm({ message: `Stop “${s.displayName}”?`, confirmLabel: 'Stop', danger: true })
    const c = await choose({
      title: `Stop ${s.displayName}?`,
      message: `It belongs to the stack “${stack}”, so it starts again the next time the stack is started or updated. To take everything in the stack down, stop the stack instead.`,
      confirmLabel: 'Stop this container',
      altLabel: 'Stop the whole stack',
      danger: true,
    })
    if (c === 'alt') {
      stackOp.run(stack, 'down')
      return false
    }
    return c === 'confirm'
  }

  return { stackOf, confirmStop }
}
