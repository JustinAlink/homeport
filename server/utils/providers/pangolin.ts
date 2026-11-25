import type { Route } from './types'
import type { LabelledContainer } from './caddy-docker-proxy'

// Pangolin blueprints as container labels (docs.pangolin.net/manage/blueprints):
// the YAML schema flattened under `pangolin.`, lists indexed with [n]:
//   pangolin.public-resources.<key>.full-domain=app.example.com
//   pangolin.public-resources.<key>.mode=http           (older: protocol=http)
//   pangolin.public-resources.<key>.targets[0].hostname=app   (default: this container)
//   pangolin.public-resources.<key>.targets[0].port=8080      (default: its exposed port)
// A site (Newt, or the pangolin CLI's `up site`) with the Docker socket applies them.
// Labels from several containers merge into one resource: one may hold the domain
// and another add a target (the docs' nginx example). `proxy-resources` is the
// older name of `public-resources`. Only http resources have a domain; tcp/udp
// resources are a raw port on the Pangolin server. Pure, exported for tests.

export const PANGOLIN_SOURCE = 'Pangolin'

interface Target {
  container: LabelledContainer
  fields: Record<string, string>
}

interface Resource {
  fields: Record<string, string>
  targets: Map<string, Target>
  definedBy: Set<LabelledContainer>
}

const RES = /^pangolin\.(?:public|proxy)-resources\.([^.]+)\.(.+)$/
const TARGET = /^targets\[(\d+)\]\.(.+)$/

export function parsePangolinLabels(containers: LabelledContainer[]): Route[] {
  const resources = new Map<string, Resource>()
  for (const c of containers) {
    for (const [k, v] of Object.entries(c.labels)) {
      const m = k.match(RES)
      if (!m) continue
      const [, key, rest] = m
      const res: Resource = resources.get(key) ?? { fields: {}, targets: new Map(), definedBy: new Set() }
      resources.set(key, res)
      const t = rest.match(TARGET)
      if (t) {
        // keyed by container too: two containers each adding a targets[0] are two targets
        const id = `${c.name}#${t[1]}`
        const target: Target = res.targets.get(id) ?? { container: c, fields: {} }
        target.fields[t[2]] = v
        res.targets.set(id, target)
      } else if (!rest.includes('.') && !rest.includes('[')) {
        res.fields[rest] ??= v // first container wins on a conflict, so the result is stable
        res.definedBy.add(c)
      }
    }
  }

  const routes: Route[] = []
  for (const res of resources.values()) {
    const f = res.fields
    const domain = (f['full-domain'] || '').trim().toLowerCase()
    const mode = (f.mode || f.protocol || 'http').toLowerCase()
    if (!domain || mode !== 'http' || f.enabled === 'false' || /[*{}\s]/.test(domain)) continue
    const ssl = f.ssl !== 'false'

    let targets = [...res.targets.values()]
    // A resource labelled with a domain but no target fields at all: the container
    // that carries it is the one to serve it (only when that is unambiguous).
    if (!targets.length && res.definedBy.size === 1) targets = [{ container: [...res.definedBy][0], fields: {} }]

    for (const t of targets) {
      if (t.fields.enabled === 'false') continue
      const host = (t.fields.hostname || '').trim() || t.container.name
      const ports = t.container.internalPorts ?? []
      const port = Number(t.fields.port) || Number(t.fields['internal-port']) || (host === t.container.name && ports.length ? Math.min(...ports) : 0)
      routes.push({ domains: [domain], upstreamHost: host, upstreamPort: port, ssl, source: PANGOLIN_SOURCE })
    }
  }
  return routes
}
