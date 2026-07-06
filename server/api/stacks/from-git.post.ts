import { getConfig } from '../../utils/config'
import { startOp } from '../../utils/ops'
import { readStack, validateCompose, runStackOp } from '../../utils/stacks'
import { safeStackName } from '../../utils/stacks-core'
import { validateRepoUrl, validateRef } from '../../utils/git-stacks-core'
import { cloneGitStack, cleanupFailedClone, ensureComposeFile, saveToken } from '../../utils/git-stacks'
import { demoStackFromGit } from '../../utils/demo'

// Create a stack from a git repository: shallow-clone into the stacks dir,
// validate the compose file (auto-generated from a Dockerfile when the repo
// ships none), then `up` — all streamed as one op. An optional access token
// (private repos) is stored server-side (0600) and never echoed.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ name?: string; repo?: string; ref?: string; token?: string }>(event)

  const repo = validateRepoUrl(String(body?.repo || ''))
  if (!repo) {
    throw createError({ statusCode: 400, statusMessage: 'repo must be an http(s) git URL without embedded credentials' })
  }
  const ref = validateRef(String(body?.ref || 'main'))
  if (!ref) throw createError({ statusCode: 400, statusMessage: 'invalid branch/tag name' })

  const fallbackName = repo.split('/').pop()?.replace(/\.git$/, '') || ''
  const name = safeStackName(String(body?.name || fallbackName))
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'invalid stack name (use letters, digits, - and _)' })
  }

  if (cfg.demo) return demoStackFromGit(name, repo, ref)
  if (!cfg.allowStacks) {
    throw createError({ statusCode: 403, statusMessage: 'Stacks are disabled (HOMEPORT_ALLOW_STACKS=true to enable).' })
  }
  if (await readStack(name)) {
    throw createError({ statusCode: 409, statusMessage: `a stack named "${name}" already exists` })
  }

  const token = String(body?.token || '').trim() || null
  if (token) saveToken(name, token)

  const opId = startOp(`clone ${name}`, async (emit) => {
    if (!(await cloneGitStack(name, repo, ref, token, emit))) return false
    // no compose file? auto-dockerize: a Dockerfile becomes a build-in-place stack
    if (!ensureComposeFile(name, emit)) return false
    const check = await validateCompose(name)
    if (!check.ok) {
      emit(`✗ compose validation failed:`)
      for (const l of (check.output || 'unknown error').split('\n')) emit(`  ${l}`)
      cleanupFailedClone(name)
      return false
    }
    return runStackOp(name, 'up', emit)
  })
  return { ok: true, stack: name, opId }
})
