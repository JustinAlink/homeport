// Open/close state for the command palette (CommandPalette.vue, mounted once
// in AppShell). Shared so any button can open it, not just the shortcut.
export function usePalette() {
  const isOpen = useState('hp:palette', () => false)
  return {
    isOpen,
    open: () => (isOpen.value = true),
    close: () => (isOpen.value = false),
    toggle: () => (isOpen.value = !isOpen.value),
  }
}
