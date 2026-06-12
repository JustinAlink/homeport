// Pure terminal-protocol helpers — no I/O, unit-testable in isolation.
//
// Wire protocol: client → server frames are JSON text:
//   { type: 'input',  data: string }            keystrokes (xterm onData)
//   { type: 'resize', cols: number, rows: number }
// server → client frames are raw terminal bytes (binary).

export type ClientFrame = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }

export function parseClientFrame(text: string): ClientFrame | null {
  try {
    const o = JSON.parse(text)
    if (o?.type === 'input' && typeof o.data === 'string') return { type: 'input', data: o.data }
    if (o?.type === 'resize') {
      const cols = Math.floor(Number(o.cols))
      const rows = Math.floor(Number(o.rows))
      if (cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000) return { type: 'resize', cols, rows }
    }
    return null
  } catch {
    return null
  }
}

/** Shell command that prefers bash, falls back to sh. */
export const SHELL_CMD = ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh']

// ---- demo shell (a tiny scripted "container" so the terminal works without Docker) ----

const DEMO_FILES = ['app.js', 'package.json', 'node_modules', 'data', '.env']

export function demoShellRespond(cmdline: string, containerName: string): string {
  const [cmd, ...args] = cmdline.trim().split(/\s+/)
  switch (cmd) {
    case '':
      return ''
    case 'ls':
      return DEMO_FILES.join('  ') + '\r\n'
    case 'pwd':
      return '/app\r\n'
    case 'whoami':
      return 'node\r\n'
    case 'hostname':
      return containerName + '\r\n'
    case 'uname':
      return 'Linux\r\n'
    case 'echo':
      return args.join(' ') + '\r\n'
    case 'cat':
      return args[0] === 'package.json'
        ? '{\r\n  "name": "demo-app",\r\n  "version": "1.0.0"\r\n}\r\n'
        : `cat: ${args[0] || ''}: No such file or directory\r\n`
    case 'help':
      return 'demo shell — try: ls, pwd, whoami, hostname, echo, cat package.json, exit\r\n'
    case 'exit':
      return '__EXIT__'
    default:
      return `sh: ${cmd}: not found\r\n`
  }
}

export const demoPrompt = (containerName: string) => `\x1b[32mnode@${containerName}\x1b[0m:\x1b[34m/app\x1b[0m$ `
