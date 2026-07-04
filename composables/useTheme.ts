export type ThemeChoice = 'system' | 'light' | 'dark'

// Theme state shared app-wide. The <head> boot script (nuxt.config.ts) applies
// the class before first paint; this composable owns changes after that.
export function useTheme() {
  const choice = useState<ThemeChoice>('hp:theme', () => 'system')
  const isDark = useState<boolean>('hp:theme-dark', () => true)

  function apply(c: ThemeChoice) {
    const dark = c === 'dark' || (c === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    isDark.value = dark
  }

  function set(c: ThemeChoice) {
    choice.value = c
    if (c === 'system') localStorage.removeItem('hp:theme')
    else localStorage.setItem('hp:theme', c)
    apply(c)
  }

  /** Cycle dark → light → system (the sidebar button). */
  function cycle() {
    set(choice.value === 'dark' ? 'light' : choice.value === 'light' ? 'system' : 'dark')
  }

  function init() {
    const stored = localStorage.getItem('hp:theme') as ThemeChoice | null
    choice.value = stored === 'dark' || stored === 'light' ? stored : 'system'
    isDark.value = document.documentElement.classList.contains('dark')
    // follow OS changes while in system mode
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (choice.value === 'system') apply('system')
    })
  }

  return { choice, isDark, set, cycle, init }
}
