import { getConfig } from '../../../utils/config'
import { resolveStack } from '../../../utils/stacks'
import { writeStackFile } from '../../../utils/stack-files'
import { safeRelPath, MAX_UPLOAD_BYTES } from '../../../utils/files-core'
import { demoFileUpload } from '../../../utils/demo'

// Upload files into a stack directory (multipart: `path` field = target dir,
// one or more `file` parts). Existing files get the usual .bak.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const name = String(getRouterParam(event, 'name') || '')
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: 'Expected multipart form data' })

  const dir = safeRelPath(parts.find((p) => p.name === 'path' && !p.filename)?.data.toString('utf8') || '')
  if (dir === null) throw createError({ statusCode: 400, statusMessage: 'invalid target path' })
  const files = parts.filter((p) => p.name === 'file' && p.filename)
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'no files in the upload' })

  if (cfg.demo) return demoFileUpload(name, dir, files.map((f) => ({ filename: f.filename!, size: f.data.length })))
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  const stack = await resolveStack(name)
  if (!stack) throw createError({ statusCode: 404, statusMessage: 'Unknown stack' })

  const saved: string[] = []
  for (const f of files) {
    if (f.data.length > MAX_UPLOAD_BYTES) {
      throw createError({ statusCode: 413, statusMessage: `${f.filename} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB` })
    }
    const base = (f.filename || '').split('/').pop()!.split('\\').pop()!
    const rel = dir ? `${dir}/${base}` : base
    try {
      writeStackFile(stack, rel, f.data)
    } catch (e: any) {
      throw createError({ statusCode: 400, statusMessage: `${base}: ${e?.message || 'write failed'}` })
    }
    saved.push(rel)
  }
  return { ok: true, saved }
})
