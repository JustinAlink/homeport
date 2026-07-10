import { getConfig } from '../../utils/config'
import { SESSION_COOKIE, decodeSessionToken } from '../../utils/session'
import { getUser } from '../../utils/users'
import { readContainerFile } from '../../utils/container-files'
import { resolveInRoot, baseName } from '../../utils/container-files-core'
import { looksBinary, MAX_EDIT_BYTES } from '../../utils/files-core'
import { demoContainerRead } from '../../utils/demo'

// Read one file inside a container: JSON {content} for editable text, or
// ?download=1 for the raw bytes. Scoped to a `root` mount destination.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const q = getQuery(event)
  const id = String(q.id || '')
  const root = String(q.root || '')
  const rel = String(q.path || '')
  const download = String(q.download || '') === '1'

  if (cfg.demo) return demoContainerRead(event, id, root, rel, download)
  if (!cfg.allowContainerFiles) {
    throw createError({ statusCode: 403, statusMessage: 'Container file editing is disabled (HOMEPORT_ALLOW_CONTAINER_FILES=true to enable).' })
  }
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  if (session?.uid && getUser(session.uid)) throw createError({ statusCode: 403, statusMessage: 'read-only account' })
  if (!id || !root) throw createError({ statusCode: 400, statusMessage: 'Expected ?id= and ?root=' })

  const abs = resolveInRoot(root, rel)
  if (abs === null) throw createError({ statusCode: 400, statusMessage: 'invalid path' })

  let file
  try {
    file = await readContainerFile(id, abs)
  } catch (e: any) {
    throw createError({ statusCode: 404, statusMessage: e?.message || 'no such file' })
  }
  if (file.isDir) throw createError({ statusCode: 400, statusMessage: 'that is a directory' })

  if (download) {
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'content-disposition', `attachment; filename="${baseName(abs)}"`)
    return file.buf
  }
  if (looksBinary(file.buf)) throw createError({ statusCode: 415, statusMessage: 'binary file — use download' })
  if (file.truncated || file.size > MAX_EDIT_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'file too large to edit here — use download' })
  }
  return { path: rel, content: file.buf.toString('utf8') }
})
