import { parseDocument, isMap, Scalar, type YAMLMap } from 'yaml'

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
    const resources = doc.getIn(['services', service, 'deploy', 'resources'], true) as YAMLMap
    dropIfEmpty(resources, 'limits')
    const deploy = svc.get('deploy', true) as YAMLMap
    dropIfEmpty(deploy, 'resources')
    dropIfEmpty(svc, 'deploy')
  }
  return doc.toString()
}
