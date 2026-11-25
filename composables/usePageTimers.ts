// Delayed work that must end with the page that scheduled it. "Follow the new
// container in 1.5 s" or "open the installed app once it shows up" used to fire
// even after the user had moved on, and yanked them off whatever page they were
// reading up to 20 s later.
export function usePageTimers() {
  let alive = true
  const timers = new Set<ReturnType<typeof setTimeout>>()

  onBeforeUnmount(() => {
    alive = false
    for (const t of timers) clearTimeout(t)
    timers.clear()
  })

  return {
    /** False once the page has unmounted: check it after every await in a polling loop. */
    alive: () => alive,
    /** setTimeout that is cancelled when the page unmounts. */
    later(fn: () => void, ms: number) {
      if (!alive) return
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
    },
    /** A pause for polling loops; it resolves either way, so check alive() after it. */
    wait(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
  }
}
