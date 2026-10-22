import type { Service } from '~/types/service'
import type { Bump } from '~/utils/updateText'

// Moves a container to a newer tag of its image (10.9.6 → 10.10.3). A managed
// stack's service is changed in its compose file and the stack brought up, which
// pulls the new tag and recreates just that service; a standalone container is
// pulled and recreated in place, with rollback if it won't start. Containers of a
// compose project homeport can't see have nowhere safe to record the change, so
// they get no switch (the next `compose up` there would undo it).
export type SwitchMode = 'stack' | 'container'

// one shared load when several rows mount at once (the Updates page list)
let readying: Promise<void> | null = null

export function useVersionSwitch() {
  const stackAware = useStackAwareActions()
  const stackOp = useStackOp()
  const updates = useUpdates()
  const services = useServices()
  const stacksStore = useStacks()
  const { caps, load: loadCaps } = useCapabilities()

  /** Whether a container is in a managed stack needs the stacks list, which not every page loads. */
  function ensureReady(): Promise<void> {
    readying ??= (async () => {
      await loadCaps()
      if (!stacksStore.loaded.value) await stacksStore.refresh()
    })().finally(() => (readying = null))
    return readying
  }
  const { confirm } = useConfirm()
  const toast = useToast()
  const busy = useState<Record<string, string>>('hp:version-busy', () => ({}))

  function mode(s: Service): SwitchMode | null {
    if (s.kind !== 'container') return null
    if (stackAware.stackOf(s) && s.composeService) return caps.value.stacks ? 'stack' : null
    if (!s.project) return caps.value.updates ? 'container' : null
    return null
  }

  /** Why a container can't switch here, for the hint shown instead of the button. */
  function blockedReason(s: Service): string {
    if (s.project && !stackAware.stackOf(s)) return `Change the tag in the compose file of “${s.project}”: homeport can't see that file, and a change made only here would be undone by its next start.`
    if (s.project) return 'Changing a stack’s compose file is off (Settings → Capabilities).'
    return 'Applying updates is off (Settings → Capabilities).'
  }

  async function switchTo(s: Service, tag: string, bump: Bump): Promise<{ ok: boolean; newId?: string }> {
    const m = mode(s)
    if (!m || busy.value[s.id]) return { ok: false }
    const go = await confirm({
      title: `Switch ${s.displayName} to ${tag}?`,
      message:
        m === 'stack'
          ? `homeport writes ${tag} into the “${s.project}” compose file and starts the stack, which pulls ${tag} and recreates ${s.displayName}. Other services are left alone.`
          : `homeport pulls ${tag} and recreates ${s.displayName} with the same settings. If the new version won't start, the current one is put back.`,
      detail: bump === 'major' ? MAJOR_NOTE : undefined,
      confirmLabel: `Switch to ${tag}`,
    })
    if (!go) return { ok: false }
    busy.value = { ...busy.value, [s.id]: tag }
    try {
      if (m === 'stack') {
        await $fetch(`/api/stacks/${encodeURIComponent(s.project!)}/service-settings`, {
          method: 'POST',
          body: { service: s.composeService, tag },
        })
        const ok = await stackOp.run(s.project!, 'up')
        await updates.refresh()
        return { ok }
      }
      const r = await $fetch<{ newId?: string }>('/api/updates/switch', {
        method: 'POST',
        body: { id: s.id, tag, name: s.name, image: s.image },
      })
      toast.success(`${s.displayName} now runs ${tag}`)
      await Promise.all([services.refresh(), updates.refresh()])
      return { ok: true, newId: r?.newId }
    } catch (e: any) {
      toast.error(errMsg(e, `Could not switch ${s.displayName} to ${tag}`))
      return { ok: false }
    } finally {
      const next = { ...busy.value }
      delete next[s.id]
      busy.value = next
    }
  }

  return { mode, blockedReason, switchTo, busy, ensureReady }
}
