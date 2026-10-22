import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateSetupCode,
  normalizeSetupCode,
  setupCodeMatches,
  judgeSetup,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  SKIP_REFUSED,
} from '../server/utils/setup-core.ts'

test('generateSetupCode: XXXX-XXXX-XXXX from the unambiguous alphabet, at least 60 bits', () => {
  // the claim the rate limit leans on: guessing must be hopeless on its own
  assert.equal(new Set(SETUP_CODE_ALPHABET).size, SETUP_CODE_ALPHABET.length)
  assert.ok(Math.log2(SETUP_CODE_ALPHABET.length) * SETUP_CODE_LENGTH >= 60)
  assert.doesNotMatch(SETUP_CODE_ALPHABET, /[ILOU]/)
  for (let i = 0; i < 50; i++) {
    const code = generateSetupCode()
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  }
})

test('generateSetupCode: a fresh code every time', () => {
  const codes = new Set(Array.from({ length: 200 }, generateSetupCode))
  assert.equal(codes.size, 200)
})

test('setupCodeMatches: the right code, however it was typed or pasted', () => {
  const code = 'AB0C-1DEF-GH2J'
  assert.equal(setupCodeMatches(code, code), true)
  assert.equal(setupCodeMatches('ab0c-1def-gh2j', code), true) // case
  assert.equal(setupCodeMatches(' AB0C 1DEF GH2J\n', code), true) // spaces, pasted newline
  assert.equal(setupCodeMatches('AB0C1DEFGH2J', code), true) // no dashes
  assert.equal(setupCodeMatches('ABOC-IDEF-GH2J', code), true) // O for 0, I for 1
  assert.equal(setupCodeMatches('AB0C-lDEF-GH2J', code), true) // l for 1
})

test('setupCodeMatches: anything else is refused', () => {
  const code = 'AB0C-1DEF-GH2J'
  assert.equal(setupCodeMatches('AB0C-1DEF-GH2K', code), false) // one character off
  assert.equal(setupCodeMatches('AB0C-1DEF-GH2', code), false) // too short
  assert.equal(setupCodeMatches('AB0C-1DEF-GH2JJ', code), false) // too long
  assert.equal(setupCodeMatches('', code), false)
  assert.equal(setupCodeMatches('----', code), false)
  assert.equal(setupCodeMatches(undefined, code), false)
  assert.equal(setupCodeMatches(null, code), false)
  assert.equal(setupCodeMatches(['AB0C-1DEF-GH2J'], code), false) // JSON body tricks
  assert.equal(setupCodeMatches({ toString: () => code }, code), false)
  assert.equal(setupCodeMatches(code + ' '.repeat(100), code), false) // oversized input
})

test('setupCodeMatches: no current code means nothing matches (not even an empty one)', () => {
  assert.equal(setupCodeMatches('', ''), false)
  assert.equal(setupCodeMatches(undefined, ''), false)
  assert.equal(setupCodeMatches('ABCD', 'ABCD'), false) // a malformed "current" code never opens the gate
})

test('normalizeSetupCode: non-strings become empty', () => {
  assert.equal(normalizeSetupCode(42), '')
  assert.equal(normalizeSetupCode(' ab-cd '), 'ABCD')
})

// --- the gate: POST /api/setup is public, so these are the security invariants ---

const CODE = 'AB0C-1DEF-GH2J'

test('judgeSetup: setup without the code is refused', () => {
  for (const body of [undefined, null, {}, { code: '' }, { code: '   ' }, { password: 'a-long-password' }] as any[]) {
    const v = judgeSetup('setup', body, CODE)
    assert.equal(v.ok, false)
    if (!v.ok) assert.equal(v.status, 400)
  }
})

test('judgeSetup: a wrong code is refused and counts toward the rate limit', () => {
  const v = judgeSetup('setup', { code: 'ZZZZ-ZZZZ-ZZZZ', password: 'a-long-password' }, CODE)
  assert.equal(v.ok, false)
  if (!v.ok) {
    assert.equal(v.status, 403)
    assert.equal(v.failedGuess, true)
    assert.equal(v.field, 'code')
  }
})

test('judgeSetup: the right code lets the password through', () => {
  assert.deepEqual(judgeSetup('setup', { code: CODE.toLowerCase(), password: 'a-long-password' }, CODE), { ok: true })
})

test('judgeSetup: "skip" is always refused, even with the right code', () => {
  for (const body of [{ skip: true }, { skip: true, code: CODE }, { skip: 1, code: CODE, password: 'a-long-password' }]) {
    const v = judgeSetup('setup', body, CODE)
    assert.equal(v.ok, false)
    if (!v.ok) {
      assert.equal(v.status, 403)
      assert.equal(v.message, SKIP_REFUSED)
      assert.match(v.message, /HOMEPORT_ALLOW_OPEN=true/) // tells the operator the real way
    }
  }
})

test('judgeSetup: once a password exists (or open mode is on), setup is closed, code or not', () => {
  for (const mode of ['enforced', 'open']) {
    const v = judgeSetup(mode, { code: CODE, password: 'a-long-password' }, CODE)
    assert.equal(v.ok, false)
    if (!v.ok) {
      assert.equal(v.status, 403)
      assert.equal(v.failedGuess, false)
    }
  }
})

test('judgeSetup: no code generated means no setup, whatever is sent', () => {
  for (const code of ['', ' ', '-', undefined] as any[]) assert.equal(judgeSetup('setup', { code, password: 'a-long-password' }, '').ok, false)
})
