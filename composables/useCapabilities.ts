export interface Capabilities {
  control: boolean
  logs: boolean
  updateCheck: boolean
  updates: boolean
  stacks: boolean
  terminal: boolean
  containerFiles: boolean
  proxyAdmin: boolean
  loginDisabled: boolean
  passwordEnvLocked: boolean
  forwardAuth: boolean
  demo: boolean
  viewer: boolean
}

const NONE: Capabilities = {
  control: false,
  logs: false,
  updateCheck: false,
  updates: false,
  stacks: false,
  terminal: false,
  containerFiles: false,
  proxyAdmin: false,
  loginDisabled: false,
  passwordEnvLocked: false,
  forwardAuth: false,
  demo: false,
  viewer: false,
}

/** Fetched once, shared app-wide; everything hidden until known. */
export function useCapabilities() {
  const caps = useState<Capabilities>('hp:caps', () => ({ ...NONE }))
  const loaded = useState('hp:caps-loaded', () => false)

  async function load() {
    if (loaded.value) return
    // A single failed fetch used to hide the ENTIRE sidebar + all controls with
    // no explanation. Retry a few times so a transient blip self-heals rather
    // than leaving the app looking feature-less until a manual reload.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        caps.value = await $fetch<Capabilities>('/api/capabilities')
        loaded.value = true
        return
      } catch (e: any) {
        // 401 = genuinely unauthenticated — retrying won't help; stop quietly.
        if ((e?.statusCode ?? e?.response?.status) === 401) return
        if (import.meta.client) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      }
    }
  }

  return { caps, loaded, load }
}
