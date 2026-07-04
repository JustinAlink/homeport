import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config'
import { findComposeFile, safeStackName } from './stacks-core'
import {
  authArgs,
  parseHeadLog,
  parseLsRemote,
  redactSecrets,
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

/** Clone a repo as a new stack (shallow, single branch). Cleans up on failure. */
export async function cloneGitStack(
  name: string,
  repo: string,
  ref: string,
  token: string | null,
  emit: (line: string) => void,
): Promise<boolean> {
  const dir = stackPath(name)
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
  let files: string[] = []
  try {
    files = readdirSync(dir)
  } catch {}
  if (!findComposeFile(files)) {
    emit('✗ the repository has no compose file at its root (compose.yaml / docker-compose.yml)')
    cleanupFailedClone(name)
    return false
  }
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
  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, ...noAuth })
  const head = await runGit(['log', '-1', '--format=%h%x1f%s%x1f%cI'], { cwd, ...noAuth })
  const parsed = parseHeadLog(head.out)
  if (remote.code !== 0 || !parsed) return null

  return {
    repo: remote.out.trim(),
    branch: branch.out.trim() || 'HEAD',
    ...parsed,
    behind: null,
  }
}

// ls-remote answers are cached briefly — the stack page polls, remotes rate-limit.
const behindCache = new Map<string, { at: number; behind: boolean | null; remoteCommit?: string }>()
const BEHIND_TTL_MS = 60_000

/** Compare local HEAD against the remote branch head (cached ~60s). */
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
  const remote = await runGit(['ls-remote', 'origin', meta.branch], { cwd, repoUrl: meta.repo, token })
  const remoteSha = parseLsRemote(remote.out)
  const result = {
    at: Date.now(),
    behind: remoteSha ? remoteSha !== local.out.trim() : null,
    remoteCommit: remoteSha?.slice(0, 7),
  }
  behindCache.set(safe, result)
  return result
}

/** Update a git stack to the remote branch head (overwrites local edits). */
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
