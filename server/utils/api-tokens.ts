import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mintToken, matchToken, type ApiTokenRecord, type TokenScope } from './api-tokens-core'

// Persistence for scoped API tokens (<data>/api-tokens.json, 0600). Only hashes
// are stored — the plaintext is returned once at creation and never again.

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'api-tokens.json')

let cache: ApiTokenRecord[] | null = null

function read(): ApiTokenRecord[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8'))
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache!
}

function persist(records: ApiTokenRecord[]): void {
  cache = records
  try {
    const dir = process.env.HOMEPORT_DATA_DIR || '/data'
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(file(), JSON.stringify(records, null, 2), { mode: 0o600 })
  } catch {
    // read-only volume: tokens live in-process only (won't survive a restart)
  }
}

/** Token metadata for the settings list — never the hash. */
export function listTokens(): Omit<ApiTokenRecord, 'hash'>[] {
  return read().map(({ hash, ...meta }) => meta)
}

/** Create a token; returns the plaintext ONCE plus its (hash-free) metadata. */
export function createToken(name: string, scope: TokenScope) {
  const { token, record } = mintToken(name, scope, Date.now())
  persist([...read(), record])
  const { hash, ...meta } = record
  return { token, meta }
}

/** Revoke by id. Returns false if no such token. */
export function revokeToken(id: string): boolean {
  const before = read()
  const after = before.filter((t) => t.id !== id)
  if (after.length === before.length) return false
  persist(after)
  return true
}

/** Verify a presented token → { id, scope } or null. Stamps lastUsedAt (throttled). */
export function verifyApiToken(token: string): { id: string; scope: TokenScope } | null {
  const rec = matchToken(token, read())
  if (!rec) return null
  const now = Date.now()
  // Stamp lastUsedAt at most ~1/min PER TOKEN, so a busy automation doesn't churn
  // disk yet every token still records when it was last used.
  if (now - (rec.lastUsedAt || 0) > 60_000) {
    rec.lastUsedAt = now
    persist(read())
  }
  return { id: rec.id, scope: rec.scope }
}
