// Files homeport shouldn't change behind their real owner's back, and the warning
// before a hand edit:
//  - a git-backed stack: every update from git runs `git reset --hard`, which puts
//    TRACKED files back (untracked ones, like a gitignored .env, survive);
//  - a stack whose compose file names another owner (`x-homeport: managed-by: ...`,
//    e.g. an Ansible playbook): that system's next run overwrites the stack's files.
// The editors show the note and ask once per file before saving.
export interface ExternalSource {
  /** git-backed: the files git tracks, and the branch */
  git?: { tracked?: string[]; branch?: string } | null
  /** x-homeport.managed-by from the compose file */
  managedBy?: string | null
}

export function useExternalSource(source: () => ExternalSource | null | undefined) {
  const { confirm } = useConfirm()
  const acknowledged = new Set<string>()

  function isTracked(path: string | null | undefined): boolean {
    if (!path) return false
    if (source()?.managedBy) return true
    return !!source()?.git?.tracked?.includes(path.replace(/^\.\//, ''))
  }

  function note(path: string): string {
    const owner = source()?.managedBy
    if (owner) return `This stack is managed by ${owner}: its next run overwrites changes to ${path} made here. To keep a change, make it there.`
    return `${path} comes from the git repository: the next update or redeploy from git puts the repository's version back. To keep a change, commit it to ${source()?.git?.branch || 'the repository'}.`
  }

  /** Resolves true when saving may go ahead. */
  async function confirmSave(path: string | null | undefined): Promise<boolean> {
    if (!path || !isTracked(path) || acknowledged.has(path)) return true
    const ok = await confirm({
      title: `Save ${path} here?`,
      message: `${note(path)} Saved here, the edit works until then.`,
      confirmLabel: 'Save anyway',
    })
    if (ok) acknowledged.add(path)
    return ok
  }

  return { isTracked, note, confirmSave }
}
