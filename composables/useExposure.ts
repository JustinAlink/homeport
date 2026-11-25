import type { Service } from '~/types/service'
import { exposureOf, exposureInput, type ExposureAck, type ExposureLevel, type ServiceExposure } from '~/shared/utils/exposure'
import { isProxyImage } from './useProxyReach'

export interface ExposureResponse {
  services: ServiceExposure[]
  summary: Record<ExposureLevel, number>
  probed: boolean
  pingEnabled: boolean
  at: number
}

/**
 * The exposure report. Loads in two passes: ports and routes answer at once, the
 * domain probes (what an anonymous visitor gets) follow and fill in. A page that
 * waits for every domain before showing anything feels broken on a big fleet.
 */
export function useExposure(id?: () => string | undefined) {
  const data = ref<ExposureResponse | null>(null)
  const probing = ref(false)
  const error = ref('')
  let seq = 0

  async function load(opts: { probe: boolean }) {
    const mine = ++seq
    if (opts.probe) probing.value = true
    try {
      const r = await $fetch<ExposureResponse>('/api/exposure', { query: { ...(opts.probe ? { probe: '1' } : {}), ...(id?.() ? { id: id() } : {}) } })
      if (mine !== seq) return // a newer load started since: its answer wins
      data.value = r
      error.value = ''
    } catch (e: any) {
      if ((e?.statusCode ?? e?.response?.status) === 401) return toLogin()
      error.value = errMsg(e, 'Could not build the exposure report')
    } finally {
      if (opts.probe) probing.value = false
    }
  }

  async function refresh() {
    await load({ probe: false })
    await load({ probe: true })
  }

  return { data, probing, error, refresh, load }
}

/**
 * How many containers need attention, for the sidebar badge. Computed from the
 * service list the app already polls: "needs attention" never depends on the
 * domain probes, so this matches the report without a request of its own.
 */
export function useExposureBadge() {
  const { data, refresh: refreshServices } = useServices()
  const acks = useExposureAcks()
  if (import.meta.client) {
    if (!acks.loaded.value) acks.refresh()
    // not every page loads the service list (the Exposure page itself doesn't):
    // without it the badge silently read 0
    if (!data.value) onMounted(() => !data.value && refreshServices())
  }
  return computed(() => {
    const list = (data.value?.services ?? []).filter((s: Service) => s.kind === 'container' && s.state === 'running')
    return list.filter((s) => exposureOf(exposureInput(s, isProxyImage(s.image)), {}, acks.acks.value).level === 'risk').length
  })
}

/** Accepted findings, shared app-wide so the badge drops an item the moment it is accepted. */
export function useExposureAcks() {
  const acks = useState<Record<string, ExposureAck>>('hp:exposure-acks', () => ({}))
  const loaded = useState<boolean>('hp:exposure-acks-loaded', () => false)
  async function refresh() {
    try {
      acks.value = (await $fetch<{ acks: Record<string, ExposureAck> }>('/api/exposure/acks')).acks
      loaded.value = true
    } catch {
      // keep the last known set; the report itself still loads
    }
  }
  async function set(key: string, code: string, note: string | null) {
    const r = await $fetch<{ acks: Record<string, ExposureAck> }>('/api/exposure/acks', { method: 'POST', body: { key, code, note } })
    acks.value = r.acks
    loaded.value = true
  }
  return { acks, loaded, refresh, set }
}
