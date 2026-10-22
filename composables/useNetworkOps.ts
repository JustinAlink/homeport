import type { Service } from '~/types/service'

// Connect / disconnect a container to a docker network, optionally writing the
// change into its stack's compose file too: `docker network connect` alone is
// undone the next time the stack is started (compose recreates the container
// from the file).
export function useNetworkOps() {
  const toast = useToast()
  const services = useServices()
  const stackAware = useStackAwareActions()

  async function persist(service: Service, patch: { addNetwork?: string; removeNetwork?: string }): Promise<string> {
    const stack = stackAware.stackOf(service)
    if (!stack || !service.composeService) return ''
    try {
      const r = await $fetch<{ changed: boolean; file: string }>(`/api/stacks/${encodeURIComponent(stack)}/service-settings`, {
        method: 'POST',
        body: { service: service.composeService, ...patch },
      })
      return r.changed ? ` and saved to ${stack}'s ${r.file}` : ''
    } catch (e: any) {
      toast.error(`Connected live, but not saved to the compose file: ${errMsg(e, 'write failed')}`)
      return ''
    }
  }

  async function connect(network: string, service: Service, opts: { save?: boolean } = {}): Promise<boolean> {
    try {
      await $fetch('/api/networks/connect', { method: 'POST', body: { network, id: service.id } })
      const saved = opts.save ? await persist(service, { addNetwork: network }) : ''
      toast.success(`${service.displayName} joined ${network}${saved}`)
      await services.refresh()
      return true
    } catch (e: any) {
      toast.error(errMsg(e, `Could not connect ${service.displayName} to ${network}`))
      return false
    }
  }

  async function disconnect(network: string, service: Service, opts: { save?: boolean } = {}): Promise<boolean> {
    try {
      await $fetch('/api/networks/disconnect', { method: 'POST', body: { network, id: service.id } })
      const saved = opts.save ? await persist(service, { removeNetwork: network }) : ''
      toast.success(`${service.displayName} left ${network}${saved}`)
      await services.refresh()
      return true
    } catch (e: any) {
      toast.error(errMsg(e, `Could not disconnect ${service.displayName} from ${network}`))
      return false
    }
  }

  return { connect, disconnect, canSave: (s: Service) => !!stackAware.stackOf(s) && !!s.composeService }
}
