// Whether homeport itself is reachable. Polled lightly while the tab is visible;
// two misses in a row raise the "connection lost" banner (AppShell) and the
// first success afterwards clears it and refreshes the live data.
export function useConnection() {
  const online = useState('hp:online', () => true)
  const misses = useState('hp:online-misses', () => 0)
  return { online, misses }
}

let timer: ReturnType<typeof setInterval> | null = null

let listening = false
let probeNow: (() => void) | null = null

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
  probeNow = probe
  // the listeners call through probeNow, so stopping leaves them idle; added once
  if (!listening) {
    listening = true
    window.addEventListener('offline', () => probeNow && (online.value = false))
    window.addEventListener('online', () => probeNow?.())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') probeNow?.()
    })
  }
}

/** Stop probing (the signed-in shell is gone: on the login page it would only collect 401s). */
export function stopConnectionWatch() {
  if (timer) clearInterval(timer)
  timer = null
  probeNow = null
}
