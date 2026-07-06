import { getConfig } from '../../../utils/config'
import { resolveStack } from '../../../utils/stacks'
import { readStackFile } from '../../../utils/stack-files'
import { looksBinary, MAX_EDIT_BYTES } from '../../../utils/files-core'
import { demoFileRead } from '../../../utils/demo'

// Read one file: JSON {content} for text small enough to edit in the browser;
// ?download=1 streams the raw bytes (any size, any type).
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const q = getQuery(event)
  const path = String(q.path || '')
  const download = String(q.download || '') === '1'

  if (cfg.demo) return demoFileRead(event, name, path, download)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await resolveStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  let file
  try {
    file = readStackFile(stack, path)
  } catch (e: any) {
    throw createError({ statusCode: 404, statusMessage: e?.message || 'no such file' })
  }

  if (download) {
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'content-disposition', `attachment; filename="${file.rel.split('/').pop()}"`)
    return file.buf
  }
  if (looksBinary(file.buf)) {
    throw createError({ statusCode: 415, statusMessage: 'binary file — use download' })
  }
  if (file.buf.length > MAX_EDIT_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'file too large to edit here — use download' })
  }
  return { path: file.rel, content: file.buf.toString('utf8') }
})
