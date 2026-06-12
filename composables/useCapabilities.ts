export interface Capabilities {
  control: boolean
  logs: boolean
  updateCheck: boolean
  updates: boolean
  stacks: boolean
  terminal: boolean
  proxyAdmin: boolean
  loginDisabled: boolean
  demo: boolean
}

const NONE: Capabilities = {
  control: false,
  logs: false,
  updateCheck: false,
  updates: false,
  stacks: false,
  terminal: false,
  proxyAdmin: false,
  loginDisabled: false,
  demo: false,
}

/** Fetched once, shared app-wide; everything hidden until known. */
export function useCapabilities() {
  const caps = useState<Capabilities>('hp:caps', () => ({ ...NONE }))
  const loaded = useState('hp:caps-loaded', () => false)

  async function load() {
    if (loaded.value) return
    try {
      caps.value = await $fetch<Capabilities>('/api/capabilities')
      loaded.value = true
    } catch {
      // unauthenticated or server error — keep everything hidden
    }
  }

  return { caps, load }
}
