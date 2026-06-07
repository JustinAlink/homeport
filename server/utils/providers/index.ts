import type { DomainProvider } from './types'
import { createNpmProvider } from './npm'
import { getConfig } from '../config'

/** Pick the active domain provider from config. NPM for now; null if not configured. */
export function getDomainProvider(): DomainProvider | null {
  const { npmConfDir } = getConfig()
  if (npmConfDir) return createNpmProvider(npmConfDir)
  return null
}
