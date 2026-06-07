import type { ServicesResponse } from '~/types/service'

/** Loads /api/services, keeps it fresh via SSE (Docker events) + a polling fallback. */
export function useServices() {
  const data = useState<ServicesResponse | null>('hp:services', () => null)
  const error = useState<string | null>('hp:error', () => null)
  const loading = useState<boolean>('hp:loading', () => true)

  let es: EventSource | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null

  async function refresh() {
    try {
      data.value = await $fetch<ServicesResponse>('/api/services')
      error.value = null
    } catch (e: any) {
      const status = e?.statusCode ?? e?.response?.status
      if (status === 401) {
        await navigateTo('/login')
        return
      }
      error.value = e?.statusMessage || e?.message || 'Failed to load services'
    } finally {
      loading.value = false
    }
  }

  function start() {
    refresh()
    if (!import.meta.client) return
    if (!es) {
      es = new EventSource('/api/events')
      es.onmessage = (ev) => {
        if (ev.data !== 'refresh') return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(refresh, 400)
      }
      // EventSource auto-reconnects on error; nothing to do.
    }
    if (!poll) poll = setInterval(refresh, 20_000)
  }

  function stop() {
    es?.close()
    es = null
    if (poll) clearInterval(poll)
    poll = null
    if (debounce) clearTimeout(debounce)
  }

  return { data, error, loading, refresh, start, stop }
}
