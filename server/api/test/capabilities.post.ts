import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { getDockerFor, oneShot } from '../../utils/docker'
import { classifyProbe, capVerdict, PROBES, CAP_REQUIREMENTS, type ProbeName, type ProbeVerdict } from '../../utils/probe-core'

// Probe what the Docker socket (proxy) actually permits, per host. Harmless by
// construction: every mutating endpoint is aimed at a nonexistent target, so a
// permitted call 404s at the daemon and changes nothing.
const PROBE_TARGET = 'homeport-permission-probe'

async function runProbe(docker: any, name: ProbeName): Promise<ProbeVerdict> {
  try {
    switch (name) {
      case 'post':
        await docker.getContainer(PROBE_TARGET).kill(oneShot())
        break
      case 'exec':
        await docker.getContainer(PROBE_TARGET).exec({ Cmd: ['true'], ...oneShot() })
        break
      case 'distribution':
        await docker.getImage(`${PROBE_TARGET}:latest`).distribution(oneShot())
        break
      case 'images':
        await docker.listImages(oneShot())
        break
      case 'networks':
        await docker.listNetworks(oneShot())
        break
      case 'volumes':
        await docker.listVolumes(oneShot())
        break
      case 'archive':
        // PUT an (empty) tar to a nonexistent container: proxies that block PUT on
        // the archive endpoint answer 403; a permitted call reaches the daemon → 404.
        await docker.getContainer(PROBE_TARGET).putArchive(Buffer.alloc(0), { path: '/', ...oneShot() })
        break
    }
    return 'allowed'
  } catch (e: any) {
    return classifyProbe(e)
  }
}

export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) {
    const probes = Object.fromEntries(PROBES.map((p) => [p, 'allowed'])) as Record<ProbeName, ProbeVerdict>
    return {
      hosts: getHosts().map((h) => ({
        name: h.name,
        probes,
        caps: Object.fromEntries(Object.keys(CAP_REQUIREMENTS).map((c) => [c, 'allowed'])),
      })),
    }
  }

  const hosts = await Promise.all(
    getHosts().map(async (h) => {
      const docker = getDockerFor(h)
      const entries = await Promise.all(PROBES.map(async (p) => [p, await runProbe(docker, p)] as const))
      const probes = Object.fromEntries(entries) as Record<ProbeName, ProbeVerdict>
      const caps = Object.fromEntries(Object.keys(CAP_REQUIREMENTS).map((c) => [c, capVerdict(probes, c)]))
      return { name: h.name, probes, caps }
    }),
  )
  return { hosts }
})
