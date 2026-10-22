import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportedProviderName } from '../server/utils/provider-label-core.ts'

test('auto-detected Traefik fallback with no routes is not reported as a proxy', () => {
  assert.equal(reportedProviderName('Traefik', {}, 0), null)
})

test('a fallback that does find routes, or any configured provider, is reported', () => {
  assert.equal(reportedProviderName('Traefik', {}, 3), 'Traefik')
  assert.equal(reportedProviderName('Nginx Proxy Manager', { npmConfDir: '/npm/proxy_host' }, 0), 'Nginx Proxy Manager')
  assert.equal(reportedProviderName('Traefik', { domainProvider: 'traefik' }, 0), 'Traefik')
  assert.equal(reportedProviderName(null, { npmConfDir: '/x' }, 5), null)
})
