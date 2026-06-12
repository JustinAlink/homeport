import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { getDockerFor } from '../utils/docker'
import { verifyCookieHeader } from '../utils/session'
import { parseClientFrame, SHELL_CMD, demoShellRespond, demoPrompt } from '../utils/terminal-core'

// Web terminal: exec into a container over a WebSocket. Client sends JSON text
// frames ({type:'input'|'resize'}), server sends raw terminal bytes.
// Gated behind HOMEPORT_ALLOW_TERMINAL (needs EXEC=1 POST=1 on the socket proxy).
//
// IMPORTANT: WebSocket upgrades bypass the h3 auth middleware — auth is enforced
// here, explicitly, in the upgrade hook.

interface TermSession {
  stream?: NodeJS.ReadWriteStream
  exec?: any
  demo?: { name: string; buf: string }
}

const sessions = new Map<string, TermSession>()

export default defineWebSocketHandler({
  upgrade(req) {
    if (!verifyCookieHeader(req.headers.get('cookie'))) {
      return new Response('Unauthorized', { status: 401 })
    }
    const cfg = getConfig()
    if (!cfg.allowTerminal && !cfg.demo) {
      return new Response('Terminal is disabled (HOMEPORT_ALLOW_TERMINAL=true to enable).', { status: 403 })
    }
  },

  async open(peer) {
    const cfg = getConfig()
    const url = new URL(peer.request?.url || 'http://x/')
    const id = String(url.searchParams.get('id') || '')
    const name = String(url.searchParams.get('name') || 'container')

    if (cfg.demo) {
      const sess: TermSession = { demo: { name, buf: '' } }
      sessions.set(peer.id, sess)
      peer.send(`\x1b[90mdemo shell — type "help"\x1b[0m\r\n${demoPrompt(name)}`)
      return
    }

    const sep = id.indexOf('::')
    const hostId = sep >= 0 ? id.slice(0, sep) : 'default'
    const containerId = sep >= 0 ? id.slice(sep + 2) : id
    const host = getHosts().find((h) => h.id === hostId)
    if (!host) {
      peer.send('\r\nunknown host\r\n')
      peer.close()
      return
    }

    try {
      const container = getDockerFor(host).getContainer(containerId)
      const exec = await container.exec({
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: SHELL_CMD,
      })
      const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as unknown as NodeJS.ReadWriteStream
      sessions.set(peer.id, { stream, exec })

      stream.on('data', (chunk: Buffer) => peer.send(chunk))
      stream.on('end', () => peer.close())
      stream.on('error', () => peer.close())
    } catch (err: any) {
      peer.send(`\r\ncould not open a shell: ${err?.message || err}\r\n`)
      peer.close()
    }
  },

  message(peer, message) {
    const sess = sessions.get(peer.id)
    if (!sess) return
    const frame = parseClientFrame(message.text())
    if (!frame) return

    // demo: line-buffered fake shell
    if (sess.demo) {
      if (frame.type !== 'input') return
      for (const ch of frame.data) {
        if (ch === '\r') {
          const reply = demoShellRespond(sess.demo.buf, sess.demo.name)
          sess.demo.buf = ''
          if (reply === '__EXIT__') {
            peer.send('\r\nexit\r\n')
            peer.close()
            return
          }
          peer.send('\r\n' + reply + demoPrompt(sess.demo.name))
        } else if (ch === '\x7f') {
          if (sess.demo.buf.length) {
            sess.demo.buf = sess.demo.buf.slice(0, -1)
            peer.send('\b \b')
          }
        } else if (ch >= ' ') {
          sess.demo.buf += ch
          peer.send(ch) // echo
        }
      }
      return
    }

    // real exec
    if (frame.type === 'input') sess.stream?.write(frame.data)
    else if (frame.type === 'resize') sess.exec?.resize({ w: frame.cols, h: frame.rows }).catch(() => {})
  },

  close(peer) {
    const sess = sessions.get(peer.id)
    sessions.delete(peer.id)
    try {
      ;(sess?.stream as any)?.destroy?.()
    } catch {}
  },
})
