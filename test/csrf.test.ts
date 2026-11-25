import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCrossOrigin, isUnsafeMethod } from '../server/utils/csrf-core.ts'

const headers = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()]

test('csrf: only state-changing methods need the check', () => {
  assert.equal(isUnsafeMethod('GET'), false)
  assert.equal(isUnsafeMethod('head'), false)
  assert.equal(isUnsafeMethod('OPTIONS'), false)
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) assert.equal(isUnsafeMethod(m), true, m)
})

test('csrf: Sec-Fetch-Site decides when present', () => {
  assert.equal(isCrossOrigin(headers({ 'sec-fetch-site': 'same-origin' })), false)
  assert.equal(isCrossOrigin(headers({ 'sec-fetch-site': 'none' })), false)
  // the homelab case SameSite=Lax lets through: another port or sibling subdomain
  assert.equal(isCrossOrigin(headers({ 'sec-fetch-site': 'same-site', origin: 'http://10.0.0.5:8080', host: '10.0.0.5:3004' })), true)
  assert.equal(isCrossOrigin(headers({ 'sec-fetch-site': 'cross-site' })), true)
  // a matching Origin cannot override a browser that says cross-site
  assert.equal(isCrossOrigin(headers({ 'sec-fetch-site': 'cross-site', origin: 'https://hub.example.com', host: 'hub.example.com' })), true)
})

test('csrf: older browsers fall back to Origin against Host', () => {
  assert.equal(isCrossOrigin(headers({ origin: 'https://hub.example.com', host: 'hub.example.com' })), false)
  assert.equal(isCrossOrigin(headers({ origin: 'http://10.0.0.5:3004', host: '10.0.0.5:3004' })), false)
  assert.equal(isCrossOrigin(headers({ origin: 'http://10.0.0.5:8080', host: '10.0.0.5:3004' })), true)
  assert.equal(isCrossOrigin(headers({ origin: 'https://evil.example.com', host: 'hub.example.com' })), true)
  assert.equal(isCrossOrigin(headers({ origin: 'null', host: 'hub.example.com' })), true)
})

test('csrf: a proxy that rewrites Host still works through X-Forwarded-Host', () => {
  const h = headers({ origin: 'https://hub.example.com', host: 'homeport:3000', 'x-forwarded-host': 'hub.example.com' })
  assert.equal(isCrossOrigin(h), false)
})

test('csrf: non-browser clients (no Origin, no Sec-Fetch-Site) pass', () => {
  assert.equal(isCrossOrigin(headers({ host: 'hub.example.com', authorization: 'Bearer hp_x' })), false)
})
