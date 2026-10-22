import { parseDocument, isMap, isSeq, Scalar, YAMLMap, YAMLSeq, type Document } from 'yaml'
import { withTag } from './versions-core.ts'

// Writes a container's restart policy and CPU/memory limits back into its
// compose file. `docker update` changes them live, but a managed stack's next
// `compose up` recreates the container from the file and silently reverts
// them, so the container page offers to save them here as well.
//
// Uses the yaml Document API (not parse + stringify) so the user's comments,
// key order and formatting survive the edit. Pure: no fs, no docker.

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure'
const POLICIES: RestartPolicy[] = ['no', 'always', 'unless-stopped', 'on-failure']

export interface ServiceSettingsPatch {
  /** undefined leaves the key alone */
  restart?: RestartPolicy
  /** cores; null or 0 removes the limit, undefined leaves it alone */
  cpus?: number | null
  /** docker size string ("512m", "2g", bytes); null or '' removes, undefined leaves alone */
  memory?: string | null
  /** docker network to attach the service to (declared external if the stack doesn't own it) */
  addNetwork?: string
  /** docker network to detach the service from */
  removeNetwork?: string
  /** move the service's image to another tag (10.9.6 → 10.10.3), registry and repo unchanged */
  tag?: string
}

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

function setImageTag(svc: YAMLMap, service: string, tag: string) {
  if (!TAG_RE.test(tag)) throw new Error(`"${tag}" is not a valid image tag`)
  const node = svc.get('image', true)
  const image = node instanceof Scalar ? node.value : node
  if (typeof image !== 'string' || !image) throw new Error(`service "${service}" has no image to change (it is built from source)`)
  // `image: app:${APP_VERSION}`: the version lives in .env, and overwriting the
  // reference here would silently stop that variable from mattering
  if (image.includes('$')) throw new Error(`the image of "${service}" comes from a variable (${image}); change the version where that variable is set, usually the stack's .env`)
  if (node instanceof Scalar) node.value = withTag(image, tag)
  else svc.set('image', withTag(image, tag))
}

const SIZE_RE = /^\d+(\.\d+)?[bkmg]?$/i

function dropIfEmpty(parent: YAMLMap, key: string) {
  const child = parent.get(key, true)
  if (isMap(child) && child.items.length === 0) parent.delete(key)
}

/**
 * Limits go where the file already keeps them: `deploy.resources.limits` when
 * that block exists, otherwise the service-level `cpus` / `mem_limit` keys.
 * Writing one place clears the other (compose rejects two different values).
 */
export function patchComposeService(content: string, service: string, patch: ServiceSettingsPatch): string {
  const doc = parseDocument(content)
  if (doc.errors.length) throw new Error(`the compose file has YAML errors: ${doc.errors[0].message}`)
  const svc = doc.getIn(['services', service], true)
  if (!isMap(svc)) throw new Error(`service "${service}" was not found in the compose file`)

  if (patch.restart !== undefined) {
    if (!POLICIES.includes(patch.restart)) throw new Error(`unknown restart policy "${patch.restart}"`)
    const value = new Scalar(patch.restart)
    // a bare `no` is a boolean to YAML 1.1 readers; compose's docs quote it too
    if (patch.restart === 'no') value.type = Scalar.QUOTE_DOUBLE
    svc.set('restart', value)
  }

  if (patch.tag !== undefined) setImageTag(svc, service, patch.tag)
  if (patch.addNetwork) addNetwork(doc, svc, service, patch.addNetwork)
  if (patch.removeNetwork) removeNetwork(doc, svc, patch.removeNetwork)

  const touchesLimits = patch.cpus !== undefined || patch.memory !== undefined
  if (!touchesLimits) return doc.toString()

  const limits = doc.getIn(['services', service, 'deploy', 'resources', 'limits'], true)
  const inDeploy = isMap(limits)

  if (patch.cpus !== undefined) {
    const cpus = patch.cpus != null && patch.cpus > 0 ? patch.cpus : null
    if (cpus != null && !Number.isFinite(cpus)) throw new Error('CPU limit must be a number of cores')
    if (inDeploy) {
      if (cpus == null) limits.delete('cpus')
      else {
        const v = new Scalar(String(cpus))
        v.type = Scalar.QUOTE_SINGLE // the compose spec types deploy cpus as a string
        limits.set('cpus', v)
      }
      svc.delete('cpus')
    } else if (cpus == null) svc.delete('cpus')
    else svc.set('cpus', cpus)
  }

  if (patch.memory !== undefined) {
    const mem = (patch.memory ?? '').trim()
    if (mem && !SIZE_RE.test(mem)) throw new Error(`"${mem}" is not a memory size (use e.g. 512m or 2g)`)
    if (inDeploy) {
      if (!mem) limits.delete('memory')
      else limits.set('memory', mem)
      svc.delete('mem_limit')
    } else if (!mem) svc.delete('mem_limit')
    else svc.set('mem_limit', mem)
  }

  if (inDeploy) {
    const resources = doc.getIn(['services', service, 'deploy', 'resources'], true) as unknown as YAMLMap
    dropIfEmpty(resources, 'limits')
    const deploy = svc.get('deploy', true) as unknown as YAMLMap
    dropIfEmpty(deploy, 'resources')
    dropIfEmpty(svc, 'deploy')
  }
  return doc.toString()
}

// --- networks ---------------------------------------------------------------
// Compose rule that makes this fiddly: a service without a `networks:` key is
// on the stack's `default` network; as soon as it lists any network it is ONLY
// on those, so adding the first one must also list `default` or the service
// silently drops off its own stack's network.

const NET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

/** Top-level networks key that refers to this docker network, if any. */
function networkKeyFor(doc: Document, project: string | null, dockerName: string): string | null {
  const nets = doc.get('networks', true)
  if (!isMap(nets)) return null
  for (const item of nets.items) {
    const key = String((item.key as any)?.value ?? item.key)
    const def = item.value as any
    const explicit = isMap(def) ? def.get('name') : undefined
    if (explicit === dockerName) return key
    if (!explicit && (key === dockerName || (project && `${project}_${key}` === dockerName))) return key
  }
  return null
}

function serviceNetworkKeys(svc: YAMLMap): string[] {
  const n = svc.get('networks', true)
  if (isSeq(n)) return n.items.map((i: any) => String(i?.value ?? i))
  if (isMap(n)) return n.items.map((i) => String((i.key as any)?.value ?? i.key))
  return []
}

function addNetwork(doc: Document, svc: YAMLMap, service: string, dockerName: string) {
  if (!NET_NAME.test(dockerName)) throw new Error(`"${dockerName}" is not a valid network name`)
  if (svc.has('network_mode')) throw new Error(`service "${service}" uses network_mode, so it can't join other networks`)
  const project = typeof doc.get('name') === 'string' ? (doc.get('name') as string) : null
  // the stack may already declare it (its own network, or an external one)
  let key = networkKeyFor(doc, project, dockerName)
  if (!key) {
    if (!doc.has('networks')) doc.set('networks', new YAMLMap())
    const nets = doc.get('networks', true) as YAMLMap
    const def = new YAMLMap()
    def.set('external', true)
    nets.set(dockerName, def)
    key = dockerName
  }
  const current = svc.get('networks', true)
  if (isMap(current)) {
    if (!current.has(key)) current.set(key, null)
  } else if (isSeq(current)) {
    if (!serviceNetworkKeys(svc).includes(key)) current.add(key)
  } else {
    const seq = new YAMLSeq()
    seq.add('default') // keep the service on its own stack's network
    if (key !== 'default') seq.add(key)
    svc.set('networks', seq)
  }
}

function removeNetwork(doc: Document, svc: YAMLMap, dockerName: string) {
  const project = typeof doc.get('name') === 'string' ? (doc.get('name') as string) : null
  const key = networkKeyFor(doc, project, dockerName) ?? (dockerName.endsWith('_default') ? 'default' : dockerName)
  const current = svc.get('networks', true)
  if (isMap(current)) current.delete(key)
  else if (isSeq(current)) {
    const idx = current.items.findIndex((i: any) => String(i?.value ?? i) === key)
    if (idx >= 0) current.items.splice(idx, 1)
  } else if (key !== 'default') return // not listed: nothing in the file to change
  else {
    // implicit default only: write an explicit empty list would cut it off entirely; leave as is
    return
  }
  // drop a now-unused external declaration this stack only kept for that service
  const nets = doc.get('networks', true)
  const services = doc.get('services', true)
  if (isMap(nets) && isMap(services)) {
    const def = nets.get(key, true)
    const stillUsed = services.items.some((it) => isMap(it.value) && serviceNetworkKeys(it.value as YAMLMap).includes(key))
    if (!stillUsed && isMap(def) && def.get('external') === true) nets.delete(key)
    if (nets.items.length === 0) doc.delete('networks')
  }
}
