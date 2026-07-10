import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getUpdateMap } from '../utils/updates'
import { findSelf } from '../utils/self-update'
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
  return { ...base, containerized: true, image: self.image, updateAvailable: entry?.status === 'update' }
})
