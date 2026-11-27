import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimAt,
  groupsFrom,
  parseGroupList,
  roleFor,
  usernameFromClaims,
  uniqueUsername,
  safeReturnTo,
  normalizePublicUrl,
  redirectUriFor,
  packState,
  unpackState,
  STATE_MAX_AGE_MS,
} from '../server/utils/oidc-core.ts'

test('oidc: group claims in the shapes providers use', () => {
  assert.deepEqual(groupsFrom(['Admins', 'homelab']), ['admins', 'homelab']) // Authentik, Pocket ID, Authelia
  assert.deepEqual(groupsFrom(['/admins', '/team/ops']), ['admins', 'team/ops']) // Keycloak full paths
  assert.deepEqual(groupsFrom('admins, ops\nviewers'), ['admins', 'ops', 'viewers']) // a delimited string
  assert.deepEqual(groupsFrom('authentik Admins,  Homelab   Admins'), ['authentik admins', 'homelab admins']) // spaces are part of a name
  assert.deepEqual(groupsFrom({ admin: { '123': 'org' }, viewer: {} }), ['admin', 'viewer']) // Zitadel roles object
  assert.deepEqual(groupsFrom(undefined), [])
  assert.deepEqual(groupsFrom([1, null, 'x']), ['x'])
  const claims = { resource_access: { homeport: { roles: ['Admin'] } }, 'urn:zitadel:iam:org:project:roles': { viewer: {} } }
  assert.deepEqual(groupsFrom(claimAt(claims, 'resource_access.homeport.roles')), ['admin'])
  assert.deepEqual(groupsFrom(claimAt(claims, 'urn:zitadel:iam:org:project:roles')), ['viewer'])
  assert.equal(claimAt(claims, 'nope.deeper'), undefined)
})

test('oidc: role mapping fails closed', () => {
  const admin = parseGroupList('homeport-admins')
  const viewer = parseGroupList('family\nfriends')
  assert.equal(roleFor(['homeport-admins', 'family'], admin, viewer), 'admin') // admin wins
  assert.equal(roleFor(['friends'], admin, viewer), 'viewer')
  assert.equal(roleFor(['everyone'], admin, viewer), null) // signed in at the provider is not enough
  assert.equal(roleFor([], admin, viewer), null)
  assert.equal(roleFor(['anything'], [], []), null) // nothing configured: nobody gets in
  // a group name with a space is one name: a member of "Homelab" is not an admin
  const admins = parseGroupList('Homelab Admins')
  const viewers = parseGroupList('Homelab')
  assert.equal(roleFor(groupsFrom(['Homelab']), admins, viewers), 'viewer')
  assert.equal(roleFor(groupsFrom(['Homelab Admins']), admins, viewers), 'admin')
  assert.equal(roleFor(groupsFrom(['Admins']), admins, viewers), null)
})

test('oidc: usernames from claims are valid, never "admin", and unique', () => {
  assert.equal(usernameFromClaims({ preferred_username: 'Fons The Bun' }), 'fons-the-bun')
  assert.equal(usernameFromClaims({ email: 'justin@example.com' }), 'justin-example.com')
  assert.equal(usernameFromClaims({ preferred_username: 'admin' }), 'admin-sso')
  assert.equal(usernameFromClaims({ sub: 'x' }), 'sso-x')
  assert.match(usernameFromClaims({ preferred_username: 'a'.repeat(60) }), /^a{28}$/)
  const taken = new Set(['fons', 'fons-2'])
  assert.equal(uniqueUsername('fons', (u) => taken.has(u)), 'fons-3')
})

test('oidc: only same-site paths can be returned to after sign-in', () => {
  assert.equal(safeReturnTo('/services/abc?tab=logs'), '/services/abc?tab=logs')
  assert.equal(safeReturnTo('/stacks/media#files'), '/stacks/media#files')
  for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', '/\t/evil.example.com', '/\n/evil.example.com', '/\r\n/evil.example.com', 'javascript:alert(1)', '/api/backup', '/login?local=1', undefined, 42])
    assert.equal(safeReturnTo(bad), '/', String(bad))
})

test('oidc: the public URL is an origin, the redirect URI is built from it', () => {
  assert.equal(normalizePublicUrl('https://hub.example.com/'), 'https://hub.example.com')
  assert.equal(normalizePublicUrl('https://hub.example.com:8443/some/path'), 'https://hub.example.com:8443')
  assert.equal(normalizePublicUrl('ftp://hub.example.com'), null)
  assert.equal(normalizePublicUrl('https://user:pw@hub.example.com'), null)
  assert.equal(normalizePublicUrl('not a url'), null)
  assert.equal(redirectUriFor('https://hub.example.com'), 'https://hub.example.com/api/auth/oidc/callback')
})

test('oidc: the state cookie is signed, expires, and resists tampering', () => {
  const now = 1_800_000_000_000
  const st = { v: 'v'.repeat(43), s: 's'.repeat(22), n: 'n'.repeat(22), r: '/updates', iat: now }
  const packed = packState(st, 'key-1')
  assert.deepEqual(unpackState(packed, 'key-1', now + 1000), st)
  assert.equal(unpackState(packed, 'other-key', now), null) // signed with another key
  assert.equal(unpackState(packed, 'key-1', now + STATE_MAX_AGE_MS + 1), null) // too old
  const [payload, sig] = packed.split('.')
  const forged = Buffer.from(JSON.stringify({ ...st, r: '/evil' })).toString('base64url')
  assert.equal(unpackState(`${forged}.${sig}`, 'key-1', now), null) // payload changed, signature didn't
  assert.equal(unpackState(`${payload}`, 'key-1', now), null)
  assert.equal(unpackState(undefined, 'key-1', now), null)
  // even a validly signed state can't carry an off-site return path
  const sneaky = packState({ ...st, r: '//evil.example.com' }, 'key-1')
  assert.equal(unpackState(sneaky, 'key-1', now)?.r, '/')
})
