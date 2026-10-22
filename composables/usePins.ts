// Containers pinned to the top of the dashboard. Stored per browser by
// container NAME (ids change on every recreate/update, names don't).
export function usePins() {
  const pins = useState<string[]>('hp:pins', () => [])
  const loaded = useState('hp:pins-loaded', () => false)

  function load() {
    if (loaded.value || !import.meta.client) return
    try {
      pins.value = JSON.parse(localStorage.getItem('hp:pins') || '[]')
    } catch {
      pins.value = []
    }
    loaded.value = true
  }
  function save() {
    try {
      localStorage.setItem('hp:pins', JSON.stringify(pins.value))
    } catch {}
  }
  const isPinned = (name: string) => pins.value.includes(name)
  function toggle(name: string) {
    load()
    pins.value = isPinned(name) ? pins.value.filter((n) => n !== name) : [...pins.value, name]
    save()
  }

  if (import.meta.client) load()
  return { pins, isPinned, toggle }
}
