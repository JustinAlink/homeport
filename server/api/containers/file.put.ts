import { getConfig } from '../../utils/config'
import { SESSION_COOKIE, decodeSessionToken } from '../../utils/session'
import { getUser } from '../../utils/users'
import { writeContainerFile } from '../../utils/container-files'
import { resolveInRoot } from '../../utils/container-files-core'
import { MAX_EDIT_BYTES } from '../../utils/files-core'
import { demoContainerWrite } from '../../utils/demo'

// Write (create or overwrite) one file inside a container via docker cp. Needs
// the socket proxy to allow PUT on /containers/{id}/archive — surfaced as a
// clear error when it doesn't. Scoped to a `root` mount destination.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ id?: string; root?: string; path?: string; content?: string }>(event)
  const id = String(body?.id || '')
  const root = String(body?.root || '')
  const rel = String(body?.path || '')
  const content = body?.content

  if (typeof content !== 'string') throw createError({ statusCode: 400, statusMessage: 'Expected { id, root, path, content }' })

  if (cfg.demo) return demoContainerWrite(id, root, rel, content)
  if (!cfg.allowContainerFiles) {
    throw createError({ statusCode: 403, statusMessage: 'Container file editing is disabled (HOMEPORT_ALLOW_CONTAINER_FILES=true to enable).' })
  }
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  if (session?.uid && getUser(session.uid)) throw createError({ statusCode: 403, statusMessage: 'read-only account' })
  if (!id || !root) throw createError({ statusCode: 400, statusMessage: 'Expected id and root' })

  const buf = Buffer.from(content, 'utf8')
  if (buf.length > MAX_EDIT_BYTES) throw createError({ statusCode: 413, statusMessage: 'file too large to save here' })

  const abs = resolveInRoot(root, rel)
  if (abs === null) throw createError({ statusCode: 400, statusMessage: 'invalid path' })

  try {
    await writeContainerFile(id, abs, buf)
  } catch (e: any) {
    const msg = String(e?.message || 'save failed')
    // socket proxies commonly block PUT on the archive endpoint — say so plainly
    const hint = /403|forbidden|method not allowed|405/i.test(msg)
      ? ' — your Docker access blocks writing files into containers (a socket proxy without PUT on /containers/*/archive)'
      : ''
    throw createError({ statusCode: 400, statusMessage: msg + hint })
  }
  return { ok: true, path: rel }
})
