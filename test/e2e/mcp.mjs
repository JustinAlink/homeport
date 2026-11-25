// The MCP endpoint end to end: mint a read-only token from the settings panel, then
// talk to POST /api/mcp the way an assistant does (both protocol eras), and check the
// auth rules around it: no token is 401, a read token still cannot POST anywhere
// else, a cross-origin browser POST is refused.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { boot } from './harness.mjs'

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const { BASE, page, check, done } = await boot({ port: 3321 })
const wait = (ms) => page.waitForTimeout(ms)
// keep a check's note to one line: it prints on PASS too
const brief = (x) => String(x).replace(/\s+/g, ' ').slice(0, 160)
const MCP = `${BASE}/api/mcp`
// plain fetch: no cookie jar, like an MCP client
const post = (body, headers = {}) =>
  fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'e2e', version: '1' } }

try {
  // ---- the panel ----
  await page.goto(BASE + '/settings?tab=security', { waitUntil: 'load' }); await wait(2000)
  const panel = page.locator('section#mcp')
  check('panel renders under Security', await panel.isVisible())
  check('panel heading', (await panel.getByRole('heading').innerText()).includes('Connect an AI assistant (MCP)'))
  check('endpoint is this origin + /api/mcp', (await panel.getByRole('textbox', { name: 'Endpoint' }).inputValue()) === MCP, await panel.getByRole('textbox', { name: 'Endpoint' }).inputValue())
  check('Claude Code tab is the default', (await panel.getByRole('button', { name: 'Claude Code', exact: true }).getAttribute('aria-pressed')) === 'true')
  check('snippet starts with a placeholder token', (await panel.locator('pre').first().innerText()).includes('<read-only-token>'))

  await panel.getByRole('button', { name: 'Create a read-only token for it' }).click(); await wait(1200)
  const cmd = await panel.locator('pre').first().innerText()
  const token = (cmd.match(/Bearer (hp_[A-Za-z0-9_-]+)/) || [])[1]
  check('token minted and filled into the Claude Code command', !!token && cmd.startsWith(`claude mcp add --transport http homeport ${MCP}`), brief(cmd))
  check('API tokens list shows it as read-only', (await page.locator('section#api-tokens').innerText()).includes('AI assistant (MCP)') && (await page.locator('section#api-tokens').innerText()).toLowerCase().includes('read-only'))

  await panel.getByRole('button', { name: 'Claude Desktop', exact: true }).click(); await wait(200)
  const desk = await panel.locator('pre').first().innerText()
  check('Claude Desktop snippet: mcp-remote bridge with the header via env', desk.includes('"mcp-remote"') && desk.includes('Authorization:${AUTH_HEADER}') && desk.includes(`Bearer ${token}`) && desk.includes('--allow-http'), brief(desk))
  check('…its tab is pressed', (await panel.getByRole('button', { name: 'Claude Desktop', exact: true }).getAttribute('aria-pressed')) === 'true')
  JSON.parse(desk) // must be valid JSON to paste
  check('Claude Desktop snippet is valid JSON', true)
  await panel.getByRole('button', { name: 'Other clients', exact: true }).click(); await wait(200)
  check('other clients: VS Code config and a curl test', (await panel.locator('pre').count()) === 2 && (await panel.innerText()).includes('.vscode/mcp.json'))

  // the panel itself passes WCAG A/AA in both themes, on every client tab (the full
  // page is covered by a11y.mjs; this keeps the check with the feature)
  await page.addScriptTag({ content: axe })
  await panel.locator('details summary').click()
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const tab of ['Claude Code', 'Claude Desktop', 'Other clients']) {
      await panel.getByRole('button', { name: tab, exact: true }).click(); await wait(250)
      const bad = await page.evaluate(async () =>
        (await window.axe.run('section#mcp', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`)),
      )
      check(`axe ${scheme} / ${tab}: no WCAG A/AA violations in the panel`, bad.length === 0, bad.slice(0, 3).join(' | '))
    }
  }

  // ---- auth around the endpoint ----
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }
  check('no token: 401', (await post(init)).status === 401)
  check('wrong token: 401', (await post(init, { authorization: 'Bearer hp_not-a-real-token' })).status === 401)
  const auth = { authorization: `Bearer ${token}` }
  check('read token still cannot POST elsewhere (403)', (await fetch(`${BASE}/api/control`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"id":"demo-0","action":"stop"}' })).status === 403)
  check('…nor POST to a path beside it', (await fetch(`${MCP}/x`, { method: 'POST', headers: auth, body: '{}' })).status === 403)
  check('cross-origin browser POST refused (403)', (await post(init, { ...auth, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status === 403)
  check('GET is 405 (no event stream)', (await fetch(MCP, { headers: auth })).status === 405)

  // ---- legacy era: initialize, then plain requests ----
  const ir = await post(init, auth)
  const ij = await ir.json()
  check('initialize: 200 with the negotiated version and server info', ir.status === 200 && ij.result?.protocolVersion === '2025-11-25' && ij.result?.serverInfo?.name === 'homeport', brief(JSON.stringify(ij)))
  check('no session id minted (stateless)', !ir.headers.get('mcp-session-id'))
  const v = { ...auth, 'mcp-protocol-version': '2025-11-25' }
  check('notifications/initialized: 202', (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, v)).status === 202)
  const lj = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, v)).json()
  const names = (lj.result?.tools || []).map((t) => t.name)
  check('tools/list: the seven read-only tools', names.join(',') === 'list_services,get_service,find_domain,list_updates,exposure_report,recent_alerts,get_logs', brief(names.join(',')))
  const fj = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_domain', arguments: { domain: 'https://jellyfin.example.com/web/' } } }, v)).json()
  const ft = fj.result?.content?.[0]?.text || ''
  check('find_domain: names the container and the proxy', ft.includes('"jellyfin"') && ft.includes('container traefik') && !fj.result.isError, brief(ft))
  check('…with HTTPS and probe info', ft.includes('HTTPS') && ft.includes('Anonymous visitor'), brief(ft))
  const pj = await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_services', arguments: { status: 'problem' } } }, v)).json()
  check('list_services problem: the restarting watchtower', (pj.result?.content?.[0]?.text || '').includes('watchtower [restarting'), brief(pj.result?.content?.[0]?.text))

  // ---- modern era: per-request _meta, mirrored headers ----
  const mh = { ...auth, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'find_domain' }
  const mr = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'find_domain', arguments: { domain: 'qbit.example.com' }, _meta: modernMeta } }, mh)
  const mj = await mr.json()
  check('modern tools/call: 200, resultType complete, server info in _meta', mr.status === 200 && mj.result?.resultType === 'complete' && mj.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name === 'homeport', brief(JSON.stringify(mj).slice(0, 300)))
  check('…qbittorrent is reachable around the proxy', (mj.result?.content?.[0]?.text || '').includes('Reachable around the proxy'))
  const bad = await post({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'find_domain', arguments: { domain: 'x' }, _meta: modernMeta } }, { ...mh, 'mcp-name': 'get_logs' })
  check('modern header mismatch: 400 with -32020', bad.status === 400 && (await bad.json()).error?.code === -32020)
  const dj = await (await post({ jsonrpc: '2.0', id: 7, method: 'server/discover', params: { _meta: modernMeta } }, { ...auth, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' })).json()
  check('server/discover lists the modern and legacy versions', dj.result?.supportedVersions?.[0] === '2026-07-28' && dj.result.supportedVersions.includes('2025-11-25'))
  const unk = await post({ jsonrpc: '2.0', id: 8, method: 'resources/list', params: { _meta: modernMeta } }, { ...auth, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'resources/list' })
  check('modern unknown method: 404 with -32601', unk.status === 404 && (await unk.json()).error?.code === -32601)
  const parse = await post('{not json', auth)
  check('unparseable body: 400 with -32700', parse.status === 400 && (await parse.json()).error?.code === -32700)
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
