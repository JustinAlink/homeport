export interface SelfUpdateState {
  version: string
  containerized: boolean
  checkEnabled: boolean
  updateAvailable: boolean
  image?: string
  /** a newer homeport VERSION (tag), shown even when a pin means there's nothing to "update" */
  newerVersion?: string
  /** who owns homeport's compose file (x-homeport managed-by), where that version gets set */
  owner?: string | null
}

// homeport's own update: availability (from the update map) + the apply flow
// (launch the detached helper, then poll /api/version until the new container
// serves and reload). Shared app-wide so the sidebar indicator and Settings
// stay in sync and there's a single implementation.
export function useSelfUpdate() {
  const state = useState<SelfUpdateState>('hp:self', () => ({ version: '', containerized: false, checkEnabled: false, updateAvailable: false }))
  const loaded = useState('hp:self-loaded', () => false)
  const busy = useState('hp:self-busy', () => false)
  const msg = useState('hp:self-msg', () => '')
  const ok = useState('hp:self-ok', () => false)
  const { caps } = useCapabilities()
  const { confirm } = useConfirm()

  async function refresh() {
    try {
      state.value = await $fetch<SelfUpdateState>('/api/self-update')
      loaded.value = true
    } catch {
      // keep last value
    }
  }

  async function run() {
    if (busy.value) return
    if (!(await confirm({ message: 'Update homeport to the latest image? The UI will briefly disconnect while the container is recreated.', confirmLabel: 'Update homeport' }))) return
    busy.value = true
    ok.value = false
    msg.value = 'starting the update helper…'
    const before = state.value.version
    try {
      await $fetch('/api/self-update', { method: 'POST' })
    } catch (e: any) {
      msg.value = errMsg(e, 'could not start the update')
      busy.value = false
      return
    }
    if (caps.value.demo) {
      await new Promise((r) => setTimeout(r, 4000))
      ok.value = true
      msg.value = 'updated (demo) — already current.'
      busy.value = false
      state.value = { ...state.value, updateAvailable: false }
      return
    }
    msg.value = 'pulling the new image… the page will reconnect by itself.'
    const deadline = Date.now() + 5 * 60_000
    const poll = async () => {
      try {
        const v = await $fetch<{ version: string }>('/api/version', { timeout: 4000 })
        if (v.version && v.version !== before) {
          msg.value = `updated to v${v.version} — reloading…`
          ok.value = true
          setTimeout(() => window.location.reload(), 1200)
          return
        }
      } catch {
        msg.value = 'homeport is restarting… reconnecting.'
      }
      if (Date.now() < deadline) setTimeout(poll, 3000)
      else {
        msg.value = 'still waiting — if this persists, check `docker ps` on the host.'
        busy.value = false
      }
    }
    setTimeout(poll, 4000)
  }

  return { state, loaded, busy, msg, ok, refresh, run }
}
