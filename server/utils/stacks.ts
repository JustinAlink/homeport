import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { getConfig } from './config'
import { findComposeFile, safeStackName, composeArgs, type StackOp } from './stacks-core'

// Compose stacks live in HOMEPORT_STACKS_DIR (each subdir = one stack, dirname =
// compose project name). Operations shell out to the docker compose CLI (bundled
// in the image), which honors DOCKER_HOST and therefore the socket proxy.
// Limitation (documented): stacks operate on the host homeport's DOCKER_HOST
// points at — local socket or tcp://; ssh:// hosts are not supported for stacks.

export interface StackFile {
  name: string
  file: string // compose filename within the dir
  content: string
}

const stacksDir = () => getConfig().stacksDir

export function listStackDirs(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = []
  let entries: string[]
  try {
    entries = readdirSync(stacksDir())
  } catch {
    return []
  }
  for (const name of entries) {
    if (!safeStackName(name)) continue
    const dir = join(stacksDir(), name)
    try {
      if (!statSync(dir).isDirectory()) continue
      const file = findComposeFile(readdirSync(dir))
      if (file) out.push({ name, file })
    } catch {
      // unreadable entry — skip
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readStack(name: string): StackFile | null {
  const safe = safeStackName(name)
  if (!safe) return null
  try {
    const dir = join(stacksDir(), safe)
    const file = findComposeFile(readdirSync(dir))
    if (!file) return null
    return { name: safe, file, content: readFileSync(join(dir, file), 'utf8') }
  } catch {
    return null
  }
}

/** Atomic save (tmp + rename) keeping a single .bak of the previous version. */
export function saveStack(name: string, content: string, createNew = false): StackFile {
  const safe = safeStackName(name)
  if (!safe) throw new Error('invalid stack name (use letters, digits, - and _)')
  const dir = join(stacksDir(), safe)

  let file: string
  if (existsSync(dir)) {
    file = findComposeFile(readdirSync(dir)) || 'compose.yaml'
  } else {
    if (!createNew) throw new Error('stack not found')
    mkdirSync(dir, { recursive: true })
    file = 'compose.yaml'
  }

  const target = join(dir, file)
  if (existsSync(target)) {
    try {
      renameSync(target, `${target}.bak`)
    } catch {
      // best-effort backup
    }
  }
  const tmp = join(dir, `.${file}.tmp`)
  writeFileSync(tmp, content)
  renameSync(tmp, target)
  return { name: safe, file, content }
}

/** Env for the compose CLI: route it at the same daemon homeport watches. */
export function composeEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig()
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (cfg.dockerHost.startsWith('ssh://')) {
    throw new Error('Stacks are not supported on ssh:// Docker hosts (run homeport on that host instead).')
  }
  if (cfg.dockerHost) env.DOCKER_HOST = cfg.dockerHost
  else delete env.DOCKER_HOST // local socket (DOCKER_SOCKET default path)
  return env
}

/** Spawn `docker compose -p <name> <args>` in the stack dir, streaming output lines. */
export function runCompose(
  name: string,
  args: string[],
  emit: (line: string) => void,
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const safe = safeStackName(name)
    if (!safe) return reject(new Error('invalid stack name'))
    const cwd = join(stacksDir(), safe)

    let env: NodeJS.ProcessEnv
    try {
      env = composeEnv()
    } catch (e) {
      return reject(e)
    }

    const child = spawn('docker', ['compose', '-p', safe, ...args], { cwd, env })
    let buf = ''
    const onChunk = (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) if (line.trim()) emit(line.trimEnd())
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (e) =>
      reject(new Error(e.message.includes('ENOENT') ? 'docker CLI not found in the homeport image/host' : e.message)),
    )
    child.on('close', (code) => {
      if (buf.trim()) emit(buf.trimEnd())
      resolve({ code: code ?? 1 })
    })
  })
}

/** Validate a compose file by running `docker compose config -q` against it. */
export function validateCompose(name: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const lines: string[] = []
    runCompose(name, ['config', '-q'], (l) => lines.push(l))
      .then(({ code }) => resolve({ ok: code === 0, output: lines.join('\n') }))
      .catch((e) => resolve({ ok: false, output: e?.message || String(e) }))
  })
}

/** Run a stack operation (up/down/restart/pull) as a streamed op. */
export async function runStackOp(name: string, op: StackOp, emit: (line: string) => void): Promise<boolean> {
  for (const args of composeArgs(op)) {
    emit(`$ docker compose -p ${name} ${args.join(' ')}`)
    const { code } = await runCompose(name, args, emit)
    if (code !== 0) {
      emit(`✗ exited with code ${code}`)
      return false
    }
  }
  emit('✓ done')
  return true
}
