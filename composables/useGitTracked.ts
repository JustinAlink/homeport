// A git-backed stack's folder is reset to the repository on every update from git
// (`git reset --hard`): edits to TRACKED files are silently put back, untracked ones
// (a gitignored .env, a generated compose file) survive. The editors use this to warn
// before such an edit, and ask once per file before saving it.
export function useGitTracked(git: () => { tracked?: string[]; branch?: string } | null | undefined) {
  const { confirm } = useConfirm()
  const acknowledged = new Set<string>()

  const isTracked = (path: string | null | undefined) => !!path && !!git()?.tracked?.includes(path.replace(/^\.\//, ''))

  const note = (path: string) =>
    `${path} comes from the git repository: the next update or redeploy from git puts the repository's version back. To keep a change, commit it to ${git()?.branch || 'the repository'}.`

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
