// A new stack's name becomes its directory AND its compose project name. Compose
// rejects project names with capitals, so the rule is lowercase only (the server
// enforces the same on create). Checked here too so the "New stack" form can say
// what is wrong before the editor opens, instead of after the user wrote a file.
export const STACK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Why `name` can't be used for a new stack, or '' when it can (an empty name is
 * not an error yet, the form just can't submit). `managed` are the stacks
 * homeport already has; `unmanaged` are compose projects running on the host
 * without visible files: a new stack with that name would take over their
 * containers on its first "up".
 */
export function newStackNameError(name: string, taken: { managed: string[]; unmanaged?: string[] }): string {
  const n = name.trim()
  if (!n) return ''
  if (!STACK_NAME_RE.test(n)) {
    if (STACK_NAME_RE.test(n.toLowerCase())) return 'Use lowercase only: compose does not accept capitals in a project name.'
    return 'Lowercase letters, digits, - and _ only, starting with a letter or digit (64 at most).'
  }
  if (taken.managed.includes(n)) return `A stack named “${n}” already exists. Open it from the list below to edit it.`
  if (taken.unmanaged?.includes(n)) return `A compose project named “${n}” already runs on this host. Pick another name.`
  return ''
}
