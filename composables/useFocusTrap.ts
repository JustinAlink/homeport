// Keeps Tab / Shift+Tab inside an open overlay (dialogs, slide-overs, the
// command palette) and puts focus back where it was when the overlay closes.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function useFocusTrap(container: Ref<HTMLElement | null>, active: Ref<boolean> | (() => boolean)) {
  const isActive = () => (typeof active === 'function' ? active() : active.value)
  let previous: HTMLElement | null = null

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !isActive() || !container.value) return
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

  watch(isActive, (on) => {
    if (!import.meta.client) return
    if (on) {
      previous = document.activeElement as HTMLElement | null
      nextTick(() => {
        if (container.value && !container.value.contains(document.activeElement)) {
          container.value.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)?.focus()
        }
      })
    } else if (previous && document.contains(previous)) {
      previous.focus()
      previous = null
    }
  }, { immediate: true })

  onMounted(() => window.addEventListener('keydown', onKey, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
}
