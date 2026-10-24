// The managed stacks (compose files homeport can see), shared app-wide so the
// dashboard can treat its groups as stacks: real status counted from the
// compose file, the services that aren't running, and whether stack actions
// (up, restart, update, down) are possible.
export interface StackInfo {
  name: string
  state: 'running' | 'partial' | 'stopped'
  running: number
  total: number
  missing?: { name: string; image?: string }[]
  file?: string
  git?: boolean
  /** x-homeport.managed-by in the compose file: another system owns it */
  managedBy?: string
  source?: 'stacks' | 'root' | 'adopted'
  dir?: string
}

/** What a dashboard group is: a stack (operable or not), a hub.group, standalone containers, host units, or pins. */
export type GroupKind = 'stack' | 'unmanaged' | 'custom' | 'standalone' | 'host' | 'pinned'

export function useStacks() {
  const stacks = useState<StackInfo[]>('hp:stacks', () => [])
  const loaded = useState('hp:stacks-loaded', () => false)
  const { caps } = useCapabilities()

  async function refresh() {
    if (!caps.value.stacks) return
    try {
      const r = await $fetch<{ stacks: StackInfo[] }>('/api/stacks')
      stacks.value = r.stacks ?? []
      loaded.value = true
    } catch {
      // stacks unavailable: the dashboard falls back to plain container groups
    }
  }

  const byName = (name: string | null | undefined) => (name ? stacks.value.find((s) => s.name === name) ?? null : null)
  /** True when homeport has the compose file for this project (it can run compose on it). */
  const isManaged = (project: string | null | undefined) => !!byName(project)
  /** Deployed from git: its folder is reset to the repository on update, so homeport must not edit its files. */
  const isGit = (project: string | null | undefined) => !!byName(project)?.git
  /** Another system (named in the compose file) owns it; homeport must not write its files either. */
  const managedBy = (project: string | null | undefined) => byName(project)?.managedBy ?? null
  /** homeport must not write this stack's files itself: git resets them, or another system owns them. */
  const isLocked = (project: string | null | undefined) => isGit(project) || !!managedBy(project)

  return { stacks, loaded, refresh, byName, isManaged, isGit, managedBy, isLocked }
}
