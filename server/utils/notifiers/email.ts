import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { parseReply, authPlain, buildMessage, splitAddresses } from './smtp-core.ts'
import { eventText } from './format.ts'
import type { AlertEvent, Notifier } from './types.ts'

// A deliberately small SMTP client — enough for "homeport mails its admin":
// implicit TLS (465) or plain + STARTTLS (587/25), AUTH PLAIN when credentials
// are set, one text/plain message per alert. No queueing, no retries beyond
// the alert engine's own; failures surface in the Send-test button.

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS from byte one (465)
  user?: string
  pass?: string
  from: string
  to: string
}

const TIMEOUT_MS = 15_000

function extractAddress(s: string): string {
  const m = /<([^>]+)>/.exec(s)
  return (m ? m[1] : s).trim()
}

export async function sendMail(cfg: SmtpConfig, subject: string, text: string): Promise<void> {
  const recipients = splitAddresses(cfg.to)
  if (!recipients.length) throw new Error('no recipient configured')

  let socket: Socket = cfg.secure
    ? (tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }) as unknown as Socket)
    : netConnect({ host: cfg.host, port: cfg.port })
  socket.setTimeout(TIMEOUT_MS)

  let buffer = ''
  let waiter: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null

  const wire = (s: Socket) => {
    s.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const reply = parseReply(buffer)
      if (reply && waiter) {
        buffer = ''
        const w = waiter
        waiter = null
        w.resolve(reply)
      }
    })
    s.on('error', (e) => waiter?.reject(e instanceof Error ? e : new Error(String(e))))
    s.on('timeout', () => {
      waiter?.reject(new Error(`SMTP timeout talking to ${cfg.host}:${cfg.port}`))
      s.destroy()
    })
    s.on('close', () => waiter?.reject(new Error('SMTP connection closed unexpectedly')))
  }
  wire(socket)

  const readReply = () =>
    new Promise<{ code: number; text: string }>((resolve, reject) => {
      waiter = { resolve, reject }
    })

  const expect = async (max: number, what: string) => {
    const r = await readReply()
    if (r.code > max) throw new Error(`${what}: ${r.text}`)
    return r
  }
  const send = (line: string) => socket.write(line + '\r\n')
  const command = async (line: string, max: number, what: string) => {
    const p = readReply()
    send(line)
    const r = await p
    if (r.code > max) throw new Error(`${what}: ${r.text}`)
    return r
  }

  try {
    await expect(299, 'greeting')
    let ehlo = await command('EHLO homeport', 299, 'EHLO')

    if (!cfg.secure && /STARTTLS/i.test(ehlo.text)) {
      await command('STARTTLS', 299, 'STARTTLS')
      // upgrade the socket in place; re-wire events onto the TLS wrapper
      socket.removeAllListeners('data')
      socket.removeAllListeners('error')
      socket.removeAllListeners('timeout')
      socket.removeAllListeners('close')
      socket = tlsConnect({ socket, servername: cfg.host }) as unknown as Socket
      socket.setTimeout(TIMEOUT_MS)
      wire(socket)
      ehlo = await command('EHLO homeport', 299, 'EHLO (tls)')
    }

    if (cfg.user && cfg.pass) {
      await command(`AUTH PLAIN ${authPlain(cfg.user, cfg.pass)}`, 299, 'AUTH')
    }

    await command(`MAIL FROM:<${extractAddress(cfg.from)}>`, 299, 'MAIL FROM')
    for (const rcpt of recipients) {
      await command(`RCPT TO:<${extractAddress(rcpt)}>`, 299, `RCPT TO ${rcpt}`)
    }
    await command('DATA', 399, 'DATA')
    const msg = buildMessage({ from: cfg.from, to: recipients, subject, text })
    await command(msg + '\r\n.', 299, 'message body')
    send('QUIT')
  } finally {
    socket.destroy()
  }
}

/** Notifier adapter for the alert engine. */
export function createEmailNotifier(cfg: SmtpConfig): Notifier {
  return {
    name: `email (${cfg.to})`,
    async send(event: AlertEvent) {
      try {
        await sendMail(cfg, `homeport · ${event.name}`, eventText(event))
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    },
  }
}
