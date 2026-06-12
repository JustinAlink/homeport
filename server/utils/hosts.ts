import { getConfig } from './config'
import { readSettings, type SettingsHost } from './settings'

export interface HostConfig {
  id: string
  name: string
  dockerHost: string // '' = local socket, tcp://… , or ssh://user@host
  dockerSshKey?: string
  sshFingerprint?: string // SHA256:… of the remote host key (optional verification)
  domainProvider?: string
  npmConfDir?: string
  caddyfilePath?: string
  nginxConfDir?: string
  traefikFilePath?: string
  // proxy admin (write side) credentials
  npmApiUrl?: string
  npmApiIdentity?: string
  npmApiSecret?: string
  caddyAdminUrl?: string
}

const slug = (s: string, fallback: string) => {
  const v = (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return v || fallback
}

function normalize(h: SettingsHost, i: number): HostConfig {
  return {
    id: slug(h.id || h.name || `host${i}`, `host${i}`),
    name: h.name || h.id || `host ${i + 1}`,
    dockerHost: h.dockerHost || '',
    dockerSshKey: h.dockerSshKey || '',
    sshFingerprint: h.sshFingerprint || '',
    domainProvider: (h.domainProvider || '').toLowerCase(),
    npmConfDir: h.npmConfDir || '',
    caddyfilePath: h.caddyfilePath || '',
    nginxConfDir: h.nginxConfDir || '',
    traefikFilePath: h.traefikFilePath || '',
    npmApiUrl: h.npmApiUrl || '',
    npmApiIdentity: h.npmApiIdentity || '',
    npmApiSecret: h.npmApiSecret || '',
    caddyAdminUrl: h.caddyAdminUrl || '',
  }
}

export function getHosts(): HostConfig[] {
  // 1) env HOMEPORT_HOSTS (locks it)
  const raw = process.env.HOMEPORT_HOSTS
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length) return arr.map(normalize)
    } catch {
      // fall through
    }
  }

  // 2) UI-managed hosts from the settings page
  const s = readSettings()
  if (s.hosts && s.hosts.length) return s.hosts.map(normalize)

  // 3) implicit single host from the standard config
  const c = getConfig()
  return [
    {
      id: 'default',
      name: process.env.HOMEPORT_HOST_NAME || 'local',
      dockerHost: c.dockerHost,
      dockerSshKey: c.dockerSshKey,
      sshFingerprint: c.dockerSshFingerprint,
      domainProvider: c.domainProvider,
      npmConfDir: c.npmConfDir,
      caddyfilePath: c.caddyfilePath,
      nginxConfDir: c.nginxConfDir,
      traefikFilePath: c.traefikFilePath,
    },
  ]
}

export const isMultiHost = () => getHosts().length > 1
