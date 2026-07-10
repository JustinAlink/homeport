import tarStream from 'tar-stream'
import { getHosts } from './hosts'
import { getDockerFor } from './docker'
import { splitServiceId } from './service-id'
import { MAX_EDIT_BYTES, type FileEntry } from './files-core'
import { baseName, parentPath, listingFromTarEntries, type TarEntryHeader } from './container-files-core'

// Read + write files INSIDE a container (or a named volume mounted into it) via
// the Docker archive endpoints — `docker cp` under the hood. No shell in the
// container is required (the daemon reads the filesystem), so this works on
// stopped and distroless containers alike. The socket proxy must allow
// GET/HEAD/PUT on /containers/{id}/archive (CONTAINERS=1 + PUT).

// Listing a directory pulls a tar of its subtree; bound how much we transfer so
// a huge mount (e.g. a media library) can't stream forever — the listing is
// marked truncated instead.
const LIST_MAX_ENTRIES = 5000
const LIST_BYTE_BUDGET = 16 * 1024 * 1024

function containerFor(id: string) {
  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw new Error('unknown host')
  if (!containerId) throw new Error('invalid container id')
  return getDockerFor(host).getContainer(containerId)
}

interface HeaderScan {
  entries: TarEntryHeader[]
  truncated: boolean
}

/** Drain a docker-archive tar, collecting entry HEADERS only (content skipped),
 *  bounded by a count + byte budget. */
function scanTarHeaders(stream: NodeJS.ReadableStream): Promise<HeaderScan> {
  return new Promise((resolve, reject) => {
    const extract = tarStream.extract()
    const entries: TarEntryHeader[] = []
    let bytes = 0
    let done = false
    const finish = (truncated: boolean) => {
      if (done) return
      done = true
      resolve({ entries, truncated })
    }
    extract.on('entry', (header: any, content: NodeJS.ReadableStream & { destroy: () => void }, next: () => void) => {
      if (done) {
        content.resume()
        return next()
      }
      if (entries.length >= LIST_MAX_ENTRIES || bytes >= LIST_BYTE_BUDGET) {
        content.destroy()
        ;(stream as any).destroy?.()
        return finish(true)
      }
      entries.push({
        name: String(header.name || ''),
        type: String(header.type || 'file'),
        size: header.size || 0,
        mtimeMs: header.mtime ? new Date(header.mtime).getTime() : 0,
      })
      bytes += header.size || 0
      content.on('end', next)
      content.on('error', () => next())
      content.resume() // skip content — we only want headers
    })
    extract.on('finish', () => finish(false))
    extract.on('error', reject)
    stream.on('error', reject)
    stream.pipe(extract)
  })
}

export interface ContainerListing {
  path: string
  entries: FileEntry[]
  truncated: boolean
}

/** One-level listing of a directory inside a container. */
export async function listContainerDir(id: string, path: string): Promise<ContainerListing> {
  const container = containerFor(id)
  const stream = (await container.getArchive({ path })) as unknown as NodeJS.ReadableStream
  const { entries, truncated } = await scanTarHeaders(stream)
  return { path, entries: listingFromTarEntries(entries, baseName(path)), truncated }
}

export interface ContainerFileRead {
  buf: Buffer
  size: number // true on-disk size (may exceed buf when truncated)
  truncated: boolean
  isDir: boolean
}

/** Read a single file's bytes (capped at MAX_EDIT_BYTES for the editor). */
export async function readContainerFile(id: string, path: string): Promise<ContainerFileRead> {
  const container = containerFor(id)
  const stream = (await container.getArchive({ path })) as unknown as NodeJS.ReadableStream
  return new Promise((resolve, reject) => {
    const extract = tarStream.extract()
    let settled = false
    extract.on('entry', (header: any, content: NodeJS.ReadableStream, next: () => void) => {
      if (settled) {
        content.resume()
        return next()
      }
      if (String(header.type) === 'directory') {
        settled = true
        content.resume()
        next()
        return resolve({ buf: Buffer.alloc(0), size: 0, truncated: false, isDir: true })
      }
      const chunks: Buffer[] = []
      let size = 0
      content.on('data', (c: Buffer) => {
        if (size < MAX_EDIT_BYTES) chunks.push(c)
        size += c.length
      })
      content.on('end', () => {
        settled = true
        resolve({ buf: Buffer.concat(chunks).subarray(0, MAX_EDIT_BYTES), size: header.size || size, truncated: size > MAX_EDIT_BYTES, isDir: false })
        next()
      })
      content.on('error', reject)
    })
    extract.on('finish', () => {
      if (!settled) resolve({ buf: Buffer.alloc(0), size: 0, truncated: false, isDir: false })
    })
    extract.on('error', reject)
    stream.on('error', reject)
    stream.pipe(extract)
  })
}

/** Build a one-file tar in memory (what putArchive extracts into a directory). */
function packOneFile(name: string, content: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tarStream.pack()
    const chunks: Buffer[] = []
    pack.on('data', (c: Buffer) => chunks.push(c))
    pack.on('end', () => resolve(Buffer.concat(chunks)))
    pack.on('error', reject)
    pack.entry({ name, size: content.length, mode: 0o644, mtime: new Date() }, content, (err: Error | null) => {
      if (err) return reject(err)
      pack.finalize()
    })
  })
}

/** Write (create or overwrite) a file inside a container at an absolute path. */
export async function writeContainerFile(id: string, path: string, content: Buffer): Promise<void> {
  const container = containerFor(id)
  const tar = await packOneFile(baseName(path), content)
  await container.putArchive(tar, { path: parentPath(path) })
}
