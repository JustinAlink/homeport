// Whether homeport itself is reachable. Polled lightly while the tab is visible;
// two misses in a row raise the "connection lost" banner (AppShell) and the
// first success afterwards clears it and refreshes the live data.
export function useConnection() {
  const online = useState('hp:online', () => true)
  const misses = useState('hp:online-misses', () => 0)
  return { online, misses }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startConnectionWatch(onRecover: () => void) {
  if (!import.meta.client || timer) return
  const { online, misses } = useConnection()
  async function probe() {
    if (document.visibilityState !== 'visible') return
    try {
      await $fetch('/api/version', { timeout: 5000 })
      if (!online.value) onRecover()
      misses.value = 0
      online.value = true
    } catch (e: any) {
      // a 401 means the server answered: we're reachable, just signed out
      if ((e?.statusCode ?? e?.response?.status) === 401) {
        misses.value = 0
        online.value = true
        return
      }
      misses.value++
      if (misses.value >= 2) online.value = false
    }
  }
  timer = setInterval(probe, 10_000)
  window.addEventListener('offline', () => (online.value = false))
  window.addEventListener('online', probe)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') probe()
  })
}
