import { getConfig } from '../../utils/config'
import { accessOf } from '../../utils/session-access'
import { listContainerDir } from '../../utils/container-files'
import { resolveInRoot } from '../../utils/container-files-core'
import { demoContainerList } from '../../utils/demo'

// List a directory INSIDE a container (or a volume mounted into it) via docker
// cp. Scoped to a `root` (a mount destination) so the browser stays within the
// app's data. Read-side of the in-container file editor.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const q = getQuery(event)
  const id = String(q.id || '')
  const root = String(q.root || '')
  const rel = String(q.path || '')

  if (cfg.demo) return demoContainerList(id, root, rel)
  if (!cfg.allowContainerFiles) {
    throw createError({ statusCode: 403, statusMessage: 'Container file editing is disabled (HOMEPORT_ALLOW_CONTAINER_FILES=true to enable).' })
  }
  // container files can hold secrets — viewers are blocked even from reading
  if (accessOf(event) === 'viewer') throw createError({ statusCode: 403, statusMessage: 'read-only account' })
  if (!id || !root) throw createError({ statusCode: 400, statusMessage: 'Expected ?id= and ?root=' })

  const abs = resolveInRoot(root, rel)
  if (abs === null) throw createError({ statusCode: 400, statusMessage: 'invalid path' })
  try {
    const listing = await listContainerDir(id, abs)
    return { root, path: rel, abs, entries: listing.entries, truncated: listing.truncated }
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not list files' })
  }
})
