import { getConfig } from './config'

// A Docker host homeport watches. Multiple hosts come from HOMEPORT_HOSTS (a JSON
// array); otherwise a single implicit host is derived from the normal config.
export interface HostConfig {
  id: string
  name: string
  dockerHost: string // '' = local socket, tcp://… , or ssh://user@host
  dockerSshKey?: string
  domainProvider?: string
  npmConfDir?: string
  caddyfilePath?: string
}

function slug(s: string, fallback: string) {
  const v = (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return v || fallback
}

export function getHosts(): HostConfig[] {
  const raw = process.env.HOMEPORT_HOSTS
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length) {
        return arr.map((h, i) => ({
          id: slug(h.id || h.name || `host${i}`, `host${i}`),
          name: h.name || h.id || `host ${i + 1}`,
          dockerHost: h.dockerHost || '',
          dockerSshKey: h.dockerSshKey || '',
          domainProvider: (h.domainProvider || '').toLowerCase(),
          npmConfDir: h.npmConfDir || '',
          caddyfilePath: h.caddyfilePath || '',
        }))
      }
    } catch {
      // fall through to single host
    }
  }

  // Implicit single host from the standard config.
  const c = getConfig()
  return [
    {
      id: 'default',
      name: process.env.HOMEPORT_HOST_NAME || 'local',
      dockerHost: c.dockerHost,
      dockerSshKey: c.dockerSshKey,
      domainProvider: c.domainProvider,
      npmConfDir: c.npmConfDir,
      caddyfilePath: c.caddyfilePath,
    },
  ]
}

export const isMultiHost = () => getHosts().length > 1
