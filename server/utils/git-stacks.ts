import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config'
import { findComposeFile, safeStackName } from './stacks-core'
import { composeForBuild, dockerfilePorts } from './autostack-core'
import {
  authArgs,
  parseHeadLog,
  parseLsRemote,
  redactSecrets,
  validateRef,
  type GitStackMeta,
} from './git-stacks-core'

// Git-backed stacks: a stack dir that is a git clone. Tokens for private
// remotes live OUTSIDE the clone under ${HOMEPORT_DATA_DIR}/git-tokens/<stack>
// (mode 0600), injected per git invocation as an Authorization header — never
// written into .git/config, and scrubbed from all streamed output.

const stacksDir = () => getConfig().stacksDir
const stackPath = (name: string) => join(stacksDir(), name)
const tokensDir = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'git-tokens')
const tokenFile = (name: string) => join(tokensDir(), name)

export function isGitStack(name: string): boolean {
  const safe = safeStackName(name)
  return !!safe && existsSync(join(stackPath(safe), '.git'))
}

export function saveToken(name: string, token: string): void {
  mkdirSync(tokensDir(), { recursive: true, mode: 0o700 })
  writeFileSync(tokenFile(name), token, { mode: 0o600 })
}

export function readToken(name: string): string | null {
  try {
    return readFileSync(tokenFile(name), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** All stored stack tokens (backup export — sensitive). */
export function listTokens(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const name of readdirSync(tokensDir())) {
      const t = readToken(name)
      if (t) out[name] = t
    }
  } catch {
    // no tokens dir yet
  }
  return out
}

export function deleteToken(name: string): void {
  try {
    rmSync(tokenFile(name), { force: true })
  } catch {
    // best-effort
  }
}

interface GitResult {
  code: number
  out: string // combined stdout+stderr, redacted
}

/** Spawn git with per-call auth injection; stream + collect redacted output. */
function runGit(
  args: string[],
  opts: { cwd?: string; repoUrl: string; token: string | null; emit?: (line: string) => void },
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...authArgs(opts.repoUrl, opts.token), ...args], {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // fail fast, never prompt
    })
    const collected: string[] = []
    let buf = ''
    const onChunk = (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const clean = redactSecrets(line.trimEnd(), opts.token)
        if (clean.trim()) {
          collected.push(clean)
          opts.emit?.(clean)
        }
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (e) =>
      reject(new Error(e.message.includes('ENOENT') ? 'git is not available in the homeport image/host' : e.message)),
    )
    child.on('close', (code) => {
      if (buf.trim()) {
        const clean = redactSecrets(buf.trimEnd(), opts.token)
        collected.push(clean)
        opts.emit?.(clean)
      }
      resolve({ code: code ?? 1, out: collected.join('\n') })
    })
  })
}

/**
 * Clone a repo as a new stack (shallow, single branch). Cleans up on failure,
 * but only a folder this call created: the folder is made here first (not
 * recursive, so an existing one is refused) and git clones into it empty.
 */
export async function cloneGitStack(
  name: string,
  repo: string,
  ref: string,
  token: string | null,
  emit: (line: string) => void,
): Promise<boolean> {
  const dir = stackPath(name)
  try {
    mkdirSync(stacksDir(), { recursive: true })
    mkdirSync(dir)
  } catch (e: any) {
    emit(e?.code === 'EEXIST' ? `✗ a folder named "${name}" already exists in the stacks directory` : `✗ ${e?.message || e}`)
    return false
  }
  emit(`$ git clone --depth 1 --branch ${ref} ${repo}`)
  const res = await runGit(
    ['clone', '--depth', '1', '--branch', ref, '--single-branch', repo, dir],
    { repoUrl: repo, token, emit },
  )
  if (res.code !== 0) {
    emit(`✗ clone failed (exit ${res.code})`)
    cleanupFailedClone(name)
    return false
  }
  // Remember what the stack follows. A tag clone leaves HEAD detached, and
  // `rev-parse --abbrev-ref HEAD` then answers "HEAD": updates fetched the
  // remote's default branch and moved a pinned stack off its tag.
  const rec = await runGit(['config', 'homeport.ref', ref], { cwd: dir, repoUrl: '', token: null })
  if (rec.code !== 0) emit(`⚠ could not record the ref "${ref}" in the clone: updates will follow its checked-out branch`)
  return true
}

/**
 * The branch or tag a git stack follows: the ref recorded at clone time, else
 * the checked-out branch, else (a tag clone made before the ref was recorded)
 * a tag pointing at HEAD. "HEAD" only when none of those is known.
 */
async function followedRef(cwd: string): Promise<string> {
  const noAuth = { repoUrl: '', token: null as string | null }
  const recorded = await runGit(['config', '--get', 'homeport.ref'], { cwd, ...noAuth })
  // read back from .git/config and passed to git as an argument: re-validated
  const ref = recorded.code === 0 ? validateRef(recorded.out.trim()) : null
  if (ref) return ref
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, ...noAuth })).out.trim()
  if (branch && branch !== 'HEAD') return branch
  const tag = await runGit(['describe', '--tags', '--exact-match', 'HEAD'], { cwd, ...noAuth })
  return (tag.code === 0 && validateRef(tag.out.trim())) || 'HEAD'
}

/** The branch or tag a git stack follows, without the rest of gitStackMeta (a webhook needs only this). */
export async function stackFollowedRef(name: string): Promise<string | null> {
  const safe = safeStackName(name)
  if (!safe || !isGitStack(safe)) return null
  return followedRef(stackPath(safe))
}

/** Short HEAD commit of a git stack (what an update just deployed). */
export async function stackHeadCommit(name: string): Promise<string | undefined> {
  const safe = safeStackName(name)
  if (!safe || !isGitStack(safe)) return undefined
  const r = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: stackPath(safe), repoUrl: '', token: null })
  return r.code === 0 ? r.out.trim() || undefined : undefined
}

/**
 * Auto-dockerize fallback for cloned repos: when the repo has no compose file
 * but ships a Dockerfile, generate a build-in-place compose.yaml (ports from
 * EXPOSE). The generated file is untracked, so git updates (reset --hard)
 * leave it alone. Cleans up the clone when the repo has neither.
 */
export function ensureComposeFile(name: string, emit: (line: string) => void): boolean {
  const dir = stackPath(name)
  let files: string[] = []
  try {
    files = readdirSync(dir)
  } catch {}
  if (findComposeFile(files)) return true

  const dockerfile = files.find((f) => f.toLowerCase() === 'dockerfile')
  if (!dockerfile) {
    emit('✗ the repository has neither a compose file nor a Dockerfile at its root — nothing to deploy')
    cleanupFailedClone(name)
    return false
  }

  let ports: number[] = []
  try {
    ports = dockerfilePorts(readFileSync(join(dir, dockerfile), 'utf8'))
  } catch {}
  emit('no compose file in the repository — generating one from its Dockerfile')
  emit(
    ports.length
      ? `  detected EXPOSE port${ports.length > 1 ? 's' : ''}: ${ports.join(', ')} (mapped 1:1 — edit the stack to change)`
      : '  no EXPOSE ports detected — add a ports: mapping to compose.yaml if the app serves anything',
  )
  writeFileSync(join(dir, 'compose.yaml'), composeForBuild(name, ports))
  emit('  wrote compose.yaml (untracked — updates from git keep it)')
  emit('  note: building through a docker-socket-proxy needs BUILD=1 on the proxy')
  return true
}

export function cleanupFailedClone(name: string): void {
  const safe = safeStackName(name)
  if (!safe) return
  try {
    rmSync(stackPath(safe), { recursive: true, force: true })
  } catch {}
  deleteToken(safe)
}

/** Local metadata: remote, branch, HEAD. Null for non-git stacks. */
export async function gitStackMeta(name: string): Promise<GitStackMeta | null> {
  const safe = safeStackName(name)
  if (!safe || !isGitStack(safe)) return null
  const cwd = stackPath(safe)
  const noAuth = { repoUrl: '', token: null as string | null }

  const remote = await runGit(['remote', 'get-url', 'origin'], { cwd, ...noAuth })
  const branch = await followedRef(cwd)
  const head = await runGit(['log', '-1', '--format=%h%x1f%s%x1f%cI'], { cwd, ...noAuth })
  const parsed = parseHeadLog(head.out)
  if (remote.code !== 0 || !parsed) return null
  // which files the next update from git would overwrite (the editors warn before editing those)
  const files = await runGit(['ls-files'], { cwd, ...noAuth })

  return {
    repo: remote.out.trim(),
    branch,
    ...parsed,
    behind: null,
    ...(files.code === 0 ? { tracked: files.out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5000) } : {}),
  }
}

// ls-remote answers are cached briefly — the stack page polls, remotes rate-limit.
const behindCache = new Map<string, { at: number; behind: boolean | null; remoteCommit?: string }>()
const BEHIND_TTL_MS = 60_000

/** Compare local HEAD against the commit the followed branch or tag points at remotely (cached ~60s). */
export async function checkBehind(
  name: string,
  force = false,
): Promise<{ behind: boolean | null; remoteCommit?: string }> {
  const safe = safeStackName(name)
  if (!safe || !isGitStack(safe)) return { behind: null }
  const hit = behindCache.get(safe)
  if (!force && hit && Date.now() - hit.at < BEHIND_TTL_MS) return hit

  const cwd = stackPath(safe)
  const meta = await gitStackMeta(safe)
  if (!meta) return { behind: null }
  const token = readToken(safe)

  const local = await runGit(['rev-parse', 'HEAD'], { cwd, repoUrl: '', token: null })
  // the `^{}` pattern is what lists an annotated tag's commit: ls-remote's
  // pattern match leaves the peeled line out for a bare tag name
  const remote = await runGit(['ls-remote', 'origin', meta.branch, `${meta.branch}^{}`], { cwd, repoUrl: meta.repo, token })
  const remoteSha = parseLsRemote(remote.out, meta.branch)
  const result = {
    at: Date.now(),
    behind: remoteSha ? remoteSha !== local.out.trim() : null,
    remoteCommit: remoteSha?.slice(0, 7),
  }
  behindCache.set(safe, result)
  return result
}

/** Update a git stack to its followed branch or tag on the remote (overwrites local edits). */
export async function updateGitStack(name: string, emit: (line: string) => void): Promise<boolean> {
  const safe = safeStackName(name)
  if (!safe || !isGitStack(safe)) {
    emit('✗ not a git-backed stack')
    return false
  }
  const cwd = stackPath(safe)
  const meta = await gitStackMeta(safe)
  if (!meta) {
    emit('✗ could not read git metadata')
    return false
  }
  const token = readToken(safe)

  emit(`$ git fetch origin ${meta.branch}`)
  const fetch = await runGit(['fetch', '--depth', '1', 'origin', meta.branch], { cwd, repoUrl: meta.repo, token, emit })
  if (fetch.code !== 0) {
    emit(`✗ fetch failed (exit ${fetch.code})`)
    return false
  }
  emit('$ git reset --hard FETCH_HEAD')
  const reset = await runGit(['reset', '--hard', 'FETCH_HEAD'], { cwd, repoUrl: '', token: null, emit })
  if (reset.code !== 0) {
    emit(`✗ reset failed (exit ${reset.code})`)
    return false
  }
  behindCache.delete(safe)
  return true
}
