import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getUpdateMap } from '../utils/updates'
import { findSelf } from '../utils/self-update'
import { readStack, stackManagedBy } from '../utils/stacks'
import { version } from '../../package.json'

// Whether homeport itself has a newer image waiting — drives the "update
// available" indicator. Reuses the cached update map (the daily check), so it
// only knows when update checks are enabled. Read-only; the POST sibling applies.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) {
    return { version, containerized: true, checkEnabled: true, updateAvailable: true, image: 'ghcr.io/justinalink/homeport:latest' }
  }

  const base = { version, containerized: false, checkEnabled: cfg.updateCheckEnabled, updateAvailable: false as boolean, image: undefined as string | undefined }
  if (!cfg.updateCheckEnabled) return base

  const self = await findSelf()
  if (!self) return base
  const entry = getUpdateMap()[`${getHosts()[0].id}|${self.image}`]
  // A pinned homeport (tag+digest, as a playbook writes it) never shows "update
  // available": the pin can't move. Its newer VERSION still matters, and where to
  // change it (the stack's owner, when its compose file names one).
  let owner: string | null = null
  if (entry?.newer && self.project) {
    const stack = await readStack(self.project).catch(() => null)
    owner = stack?.dir ? stackManagedBy(stack.dir, stack.content) : null
  }
  return {
    ...base,
    containerized: true,
    image: self.image,
    updateAvailable: entry?.status === 'update',
    newerVersion: entry?.newer?.tag,
    owner,
  }
})
