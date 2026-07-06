import type { HostConfig } from './hosts'
import { getDockerFor, oneShot } from './docker'

// Docker volumes + images with reference counts — the data behind /storage.
// Deleting a stack or container leaves its volumes (and often images) behind
// by design; this is where those leftovers become visible and removable.
// Needs VOLUMES=1 / IMAGES=1 on a socket proxy; removal additionally POST=1.

export interface VolumeInfo {
  name: string
  driver: string
  createdAt: number // unix ms, 0 if unknown
  project: string | null
  attached: { id: string; name: string }[]
}

export interface ImageInfo {
  id: string
  /** Best display ref: first repo tag, else short digest, else short id. */
  ref: string
  dangling: boolean
  size: number
  createdAt: number // unix ms
  attached: { id: string; name: string }[]
}

export async function listVolumesFor(host: HostConfig): Promise<VolumeInfo[]> {
  const docker = getDockerFor(host)
  const [res, containers] = await Promise.all([
    docker.listVolumes(oneShot()),
    docker.listContainers({ all: true, ...oneShot() }),
  ])

  // volume references via container mounts (stopped containers count — the
  // volume is still that container's data)
  const refs = new Map<string, { id: string; name: string }[]>()
  for (const c of containers) {
    const entry = { id: `${host.id}::${c.Id}`, name: (c.Names?.[0] || '').replace(/^\//, '') }
    for (const m of c.Mounts || []) {
      if (m.Type === 'volume' && m.Name) refs.set(m.Name, [...(refs.get(m.Name) || []), entry])
    }
  }

  return (res.Volumes || [])
    .map((v) => ({
      name: v.Name,
      driver: v.Driver || '',
      createdAt: v.CreatedAt ? Date.parse(v.CreatedAt as unknown as string) || 0 : 0,
      project: (v.Labels || {})['com.docker.compose.project'] || null,
      attached: refs.get(v.Name) || [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Volume disk usage via `docker system df` — separate call, it can be slow. */
export async function volumeSizesFor(host: HostConfig): Promise<Record<string, number>> {
  const df = await (getDockerFor(host) as any).df()
  const out: Record<string, number> = {}
  for (const v of df?.Volumes || []) {
    if (v?.Name && v?.UsageData && typeof v.UsageData.Size === 'number' && v.UsageData.Size >= 0) {
      out[v.Name] = v.UsageData.Size
    }
  }
  return out
}

export async function removeVolumeFor(host: HostConfig, name: string): Promise<void> {
  const vols = await listVolumesFor(host)
  const vol = vols.find((v) => v.name === name)
  if (!vol) throw new Error(`no volume named "${name}"`)
  if (vol.attached.length > 0) {
    throw new Error(
      `volume "${name}" is still used by ${vol.attached.map((c) => c.name).join(', ')} — delete those containers first`,
    )
  }
  await getDockerFor(host).getVolume(name).remove()
}

export async function listImagesFor(host: HostConfig): Promise<ImageInfo[]> {
  const docker = getDockerFor(host)
  const [images, containers] = await Promise.all([
    docker.listImages({ all: false, ...oneShot() }),
    docker.listContainers({ all: true, ...oneShot() }),
  ])

  const refs = new Map<string, { id: string; name: string }[]>()
  for (const c of containers) {
    const entry = { id: `${host.id}::${c.Id}`, name: (c.Names?.[0] || '').replace(/^\//, '') }
    if (c.ImageID) refs.set(c.ImageID, [...(refs.get(c.ImageID) || []), entry])
  }

  return images
    .map((i) => {
      const tag = (i.RepoTags || []).filter((t) => t !== '<none>:<none>')[0]
      const digest = (i.RepoDigests || []).filter((d) => !d.startsWith('<none>'))[0]
      return {
        id: i.Id,
        ref: tag || (digest ? digest.split('@')[0] + '@' + digest.split(':').pop()!.slice(0, 12) : i.Id.replace('sha256:', '').slice(0, 12)),
        dangling: !tag,
        size: i.Size || 0,
        createdAt: (i.Created || 0) * 1000,
        attached: refs.get(i.Id) || [],
      }
    })
    .sort((a, b) => a.ref.localeCompare(b.ref))
}

export async function removeImageFor(host: HostConfig, id: string): Promise<void> {
  const images = await listImagesFor(host)
  const img = images.find((i) => i.id === id)
  if (!img) throw new Error('no such image')
  if (img.attached.length > 0) {
    throw new Error(
      `image is still used by ${img.attached.map((c) => c.name).join(', ')} — delete those containers first`,
    )
  }
  await getDockerFor(host).getImage(id).remove()
}
