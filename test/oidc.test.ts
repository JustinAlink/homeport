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
  effectiveScopes,
  pickClientAuth,
  describeOidcError,
  oidcFailureKind,
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

test('oidc: only scopes the provider offers are asked for (Keycloak rejects the rest)', () => {
  // Keycloak 26: no "groups" scope; asking for it fails every sign-in with invalid_scope
  const keycloak = ['openid', 'profile', 'email', 'roles', 'web-origins', 'acr', 'offline_access']
  assert.deepEqual(effectiveScopes('openid profile email groups', keycloak), { scope: 'openid profile email', dropped: ['groups'] })
  // Authelia and Pocket ID offer it: kept
  assert.equal(effectiveScopes('openid profile email groups', ['openid', 'profile', 'email', 'groups']).scope, 'openid profile email groups')
  // no list published: send as configured, openid always first and once
  assert.deepEqual(effectiveScopes('profile groups openid', undefined), { scope: 'openid profile groups', dropped: [] })
  assert.equal(effectiveScopes('', ['profile']).scope, 'openid') // openid even when the list leaves it out
})

test('oidc: the client secret goes by HTTP Basic unless the provider only takes it in the body', () => {
  assert.equal(pickClientAuth(['client_secret_basic', 'client_secret_post']), 'client_secret_basic') // Keycloak, Authentik, Authelia
  assert.equal(pickClientAuth(['client_secret_post']), 'client_secret_post')
  assert.equal(pickClientAuth(undefined), 'client_secret_basic') // the standard's default
  assert.equal(pickClientAuth(['private_key_jwt']), 'client_secret_basic')
})

test('oidc: a failed exchange is logged with the provider\'s own reason', () => {
  const e = Object.assign(new Error('server responded with an error in the response body'), { error: 'invalid_client', error_description: 'client authentication failed', code: 'OAUTH_RESPONSE_BODY_ERROR', status: 401 })
  assert.equal(describeOidcError(e), 'invalid_client: client authentication failed · server responded with an error in the response body · OAUTH_RESPONSE_BODY_ERROR · HTTP 401')
  assert.equal(describeOidcError('plain'), 'plain')
})

test('oidc: a refused HS256 token is named as such, from the wrapped cause', () => {
  // what openid-client throws for Authentik without a signing key
  const inner = Object.assign(new Error('unsupported JWS algorithm'), { cause: { alg: 'HS256' } })
  const e = Object.assign(new Error('unsupported operation'), { code: 'OAUTH_UNSUPPORTED_OPERATION', cause: inner })
  assert.equal(describeOidcError(e), 'unsupported operation · OAUTH_UNSUPPORTED_OPERATION · unsupported JWS algorithm · alg HS256')
  assert.equal(oidcFailureKind(e), 'signature')
  assert.equal(oidcFailureKind(Object.assign(new Error('x'), { error: 'invalid_client' })), 'client')
  assert.equal(oidcFailureKind(new Error('fetch failed')), null)
})
