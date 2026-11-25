// Keeps Tab / Shift+Tab inside an open overlay (dialogs, slide-overs, the
// command palette) and puts focus back where it was when the overlay closes.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

// Overlays stack (a confirm dialog over a file editor), and every trap listens
// on window. Only the most recently opened active trap may act: with all of them
// handling Tab, the one behind pulled focus back into itself on every keypress.
// Client-only: traps engage in the browser, never during SSR.
const openTraps: symbol[] = []

export function useFocusTrap(container: Ref<HTMLElement | null>, active: Ref<boolean> | (() => boolean)) {
  const isActive = () => (typeof active === 'function' ? active() : active.value)
  const self = Symbol('focus-trap')
  let engaged = false
  let previous: HTMLElement | null = null

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !engaged || openTraps[openTraps.length - 1] !== self || !container.value) return
    const items = [...container.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const inside = container.value.contains(document.activeElement)
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  function engage() {
    if (engaged) return
    engaged = true
    openTraps.push(self)
    previous = document.activeElement as HTMLElement | null
    nextTick(() => {
      if (container.value && !container.value.contains(document.activeElement)) {
        container.value.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)?.focus()
      }
    })
  }

  // Runs on deactivate AND on unmount: an overlay that is simply removed from
  // the page (v-if, always "active" while it exists) must hand focus back too.
  function release() {
    if (!engaged) return
    engaged = false
    const i = openTraps.indexOf(self)
    if (i >= 0) openTraps.splice(i, 1)
    if (previous && document.contains(previous)) previous.focus()
    previous = null
  }

  watch(
    isActive,
    (on) => {
      if (!import.meta.client) return
      if (on) engage()
      else release()
    },
    { immediate: true },
  )

  onMounted(() => window.addEventListener('keydown', onKey, true))
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, true)
    release()
  })
}
