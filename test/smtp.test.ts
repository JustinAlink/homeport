import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { parseReply, authPlain, encodeHeader, buildMessage, splitAddresses } from '../server/utils/notifiers/smtp-core.ts'
import { sendMail } from '../server/utils/notifiers/email.ts'

test('parseReply: waits for complete, final reply lines', () => {
  assert.equal(parseReply('250-STARTTLS\r\n'), null) // multiline, not done
  assert.equal(parseReply('250 ok'), null) // no CRLF yet
  assert.deepEqual(parseReply('250-SIZE 100\r\n250 AUTH PLAIN\r\n'), { code: 250, done: true, text: '250-SIZE 100 250 AUTH PLAIN' })
  assert.equal(parseReply('535 auth failed\r\n')!.code, 535)
})

test('authPlain: RFC 4616 shape', () => {
  assert.equal(Buffer.from(authPlain('u', 'p'), 'base64').toString('utf8'), '\0u\0p')
})

test('encodeHeader: ascii passes through, utf-8 gets RFC 2047', () => {
  assert.equal(encodeHeader('plain subject'), 'plain subject')
  assert.match(encodeHeader('ümlaut'), /^=\?utf-8\?B\?.+\?=$/)
  assert.equal(encodeHeader('inj\r\nected'), 'inj ected')
})

test('buildMessage: CRLF endings, dot stuffing, headers present', () => {
  const msg = buildMessage({ from: 'a@x', to: ['b@y'], subject: 's', text: 'line1\n.hidden\nline3', date: 'Sat, 05 Jul 2026 20:00:00 GMT' })
  assert.match(msg, /^From: a@x\r\n/)
  assert.match(msg, /\r\n\r\nline1\r\n\.\.hidden\r\nline3$/)
})

test('splitAddresses: commas/semicolons, trimmed', () => {
  assert.deepEqual(splitAddresses('a@x, b@y ;c@z,'), ['a@x', 'b@y', 'c@z'])
})

test('sendMail: full plaintext SMTP session against a scratch server', async () => {
  const transcript: string[] = []
  let dataMode = false
  let body = ''
  const server = createServer((sock) => {
    sock.write('220 test ESMTP\r\n')
    let buf = ''
    sock.on('data', (c) => {
      buf += c.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        if (dataMode) {
          if (line === '.') {
            dataMode = false
            sock.write('250 queued\r\n')
          } else {
            body += line + '\n'
          }
          continue
        }
        transcript.push(line)
        if (line.startsWith('EHLO')) sock.write('250-test\r\n250 AUTH PLAIN\r\n')
        else if (line.startsWith('AUTH')) sock.write('235 ok\r\n')
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 ok\r\n')
        else if (line === 'DATA') {
          dataMode = true
          sock.write('354 go\r\n')
        } else if (line === 'QUIT') sock.write('221 bye\r\n')
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port

  await sendMail(
    { host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p', from: 'homeport <hp@x>', to: 'admin@y' },
    'homeport · test',
    'it works',
  )
  server.close()

  assert.ok(transcript.some((l) => l.startsWith('AUTH PLAIN')))
  assert.ok(transcript.includes('MAIL FROM:<hp@x>'))
  assert.ok(transcript.includes('RCPT TO:<admin@y>'))
  // "·" is non-ASCII → the subject is RFC 2047-encoded
  assert.match(body, new RegExp(`Subject: =\\?utf-8\\?B\\?${Buffer.from('homeport · test', 'utf8').toString('base64')}\\?=`))
  assert.match(body, /it works/)
})
