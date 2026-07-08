import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  base32Encode,
  base32Decode,
  hotp,
  totpCounter,
  verifyTotp,
  randomSecret,
  otpauthUri,
  mintRecoveryCodes,
  matchRecoveryCode,
} from '../server/utils/totp-core.ts'

test('base32Encode/base32Decode round-trip', () => {
  const buf = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
  assert.deepEqual(base32Decode(base32Encode(buf)), buf)
  assert.equal(base32Decode('').length, 0)
})

// RFC 6238 Appendix B test vectors (SHA1). The RFC's reference codes are 8
// digits; the last 6 digits equal our 6-digit truncation (mod 10^6 of the
// same binary value), so these pin our HOTP/truncation against the spec.
test('hotp: matches RFC 6238 SHA1 test vectors (last 6 digits)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii')
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ]
  for (const [timeSec, expected] of vectors) {
    const counter = totpCounter(timeSec * 1000)
    assert.equal(hotp(secret, counter), expected, `time=${timeSec}`)
  }
})

test('verifyTotp: round-trips a freshly minted secret', () => {
  const secret = randomSecret()
  const now = 1_700_000_000_000
  const counter = totpCounter(now)
  const code = hotp(base32Decode(secret), counter)
  assert.equal(verifyTotp(secret, code, now).valid, true)
})

test('verifyTotp: tolerates ±1 step of clock drift, not ±2', () => {
  const secret = randomSecret()
  const now = 1_700_000_000_000
  const counter = totpCounter(now)
  const nextStepCode = hotp(base32Decode(secret), counter + 1)
  const twoStepsCode = hotp(base32Decode(secret), counter + 2)
  assert.equal(verifyTotp(secret, nextStepCode, now).valid, true)
  assert.equal(verifyTotp(secret, twoStepsCode, now).valid, false)
})

test('verifyTotp: rejects garbage/wrong-length codes without throwing', () => {
  const secret = randomSecret()
  assert.equal(verifyTotp(secret, '', Date.now()).valid, false)
  assert.equal(verifyTotp(secret, 'abcdef', Date.now()).valid, false)
  assert.equal(verifyTotp(secret, '12345', Date.now()).valid, false)
  assert.equal(verifyTotp(secret, '1234567', Date.now()).valid, false)
})

test('verifyTotp: a counter at or before lastCounter is rejected (replay guard)', () => {
  const secret = randomSecret()
  const now = 1_700_000_000_000
  const counter = totpCounter(now)
  const code = hotp(base32Decode(secret), counter)
  assert.equal(verifyTotp(secret, code, now, counter).valid, false) // already used
  assert.equal(verifyTotp(secret, code, now, counter - 1).valid, true) // not yet used
})

test('otpauthUri: encodes label/issuer/secret for authenticator apps', () => {
  const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'admin', 'homeport')
  assert.ok(uri.startsWith('otpauth://totp/homeport:admin?'))
  assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'))
  assert.ok(uri.includes('issuer=homeport'))
  assert.ok(uri.includes('digits=6'))
  assert.ok(uri.includes('period=30'))
})

test('recovery codes: mint, match, single-use semantics at the caller level', () => {
  const { codes, hashes } = mintRecoveryCodes(5)
  assert.equal(codes.length, 5)
  assert.equal(hashes.length, 5)
  // hashes never equal the plaintext they came from
  for (let i = 0; i < codes.length; i++) assert.notEqual(hashes[i], codes[i])
  assert.equal(matchRecoveryCode(codes[2], hashes), 2)
  assert.equal(matchRecoveryCode('not-a-real-code', hashes), -1)
  assert.equal(matchRecoveryCode('', hashes), -1)
})
