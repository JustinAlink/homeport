import type { ExposureLevel, ExposurePort, ExposureRoute } from '~/shared/utils/exposure'

// Presentation for the exposure report: level names, reach wording, port ranges.
// Facts stay neutral (a port is just "every interface"); colour belongs to findings.

export const EXPOSURE_META: Record<ExposureLevel, { label: string; hint: string; dot: string; text: string }> = {
  risk: { label: 'Needs attention', hint: 'Reachable in a way that skips the proxy or controls Docker', dot: 'bg-red-400', text: 'text-red-300' },
  warn: { label: 'Worth a look', hint: 'Plain HTTP, or a database or admin port open', dot: 'bg-amber-400', text: 'text-amber-300' },
  open: { label: 'Open ports', hint: 'Published on every interface, no domain', dot: 'bg-sky-400', text: 'text-sky-300' },
  proxied: { label: 'Through the proxy', hint: 'Reached by its domain, nothing else open', dot: 'bg-ok', text: 'text-ok' },
  internal: { label: 'Not published', hint: 'No domain, and nothing open beyond this machine or LAN', dot: 'bg-slate-500', text: 'text-slate-400' },
}

/** What an anonymous visitor gets from a route, in a few words. */
export function routeAccessText(r: ExposureRoute, probing: boolean): string {
  switch (r.access) {
    case 'login':
      return 'asks for a login'
    case 'sso':
      return `sign-in at ${r.signIn}`
    case 'open':
      return 'opens for anyone'
    case 'refused':
      return 'refuses anonymous visitors'
    case 'error':
      return `answers HTTP ${r.status}`
    case 'down':
      return 'no answer'
    default:
      return probing ? 'checking…' : 'not checked'
  }
}

/** Plain words for where a port listens. */
export function scopeText(p: ExposurePort): string {
  if (p.scope === 'all') return 'every interface'
  if (p.scope === 'loopback') return 'this machine only'
  return `${p.addrs.join(', ')} only`
}

/** Exact bindings, for a tooltip: `0.0.0.0:8090 → 8080/tcp`. */
export function bindingText(p: ExposurePort): string {
  const addrs = p.addrs.length ? p.addrs : ['0.0.0.0']
  return addrs.map((a) => `${a.includes(':') ? `[${a}]` : a || '0.0.0.0'}:${p.hostPort} → ${p.containerPort}/${p.type}`).join(', ')
}

export interface PortGroup {
  label: string
  scope: ExposurePort['scope']
  ports: ExposurePort[]
}

/**
 * Runs of consecutive ports with the same scope, type and offset collapse into
 * one range (a game server's 27015-27030), so a long port list stays readable.
 */
export function groupPorts(ports: ExposurePort[]): PortGroup[] {
  const sorted = [...ports].sort((a, b) => a.hostPort - b.hostPort)
  const out: PortGroup[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    const prev = last?.ports[last.ports.length - 1]
    if (
      prev &&
      prev.hostPort + 1 === p.hostPort &&
      prev.containerPort + 1 === p.containerPort &&
      prev.type === p.type &&
      prev.scope === p.scope &&
      prev.addrs.join() === p.addrs.join()
    ) {
      last.ports.push(p)
    } else {
      out.push({ label: '', scope: p.scope, ports: [p] })
    }
  }
  for (const g of out) {
    const a = g.ports[0]
    const b = g.ports[g.ports.length - 1]
    const host = a === b ? `${a.hostPort}` : `${a.hostPort}-${b.hostPort}`
    const inner = a === b ? `${a.containerPort}` : `${a.containerPort}-${b.containerPort}`
    g.label = `:${host}${host === inner ? '' : ` → ${inner}`}${a.type === 'udp' ? '/udp' : ''}`
  }
  return out
}

/** Split a fix sentence into text and `code` parts (code renders copyable). */
export function codeParts(text: string): { code: boolean; text: string }[] {
  return text.split('`').map((t, i) => ({ code: i % 2 === 1, text: t })).filter((p) => p.text)
}
