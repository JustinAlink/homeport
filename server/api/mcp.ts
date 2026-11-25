import { handleMcpPost, MAX_BODY_BYTES } from '../utils/mcp-core'
import { fleetSource, homeportMcp } from '../utils/mcp'

// POST /api/mcp: the Model Context Protocol endpoint (Streamable HTTP), so an AI
// assistant can ask homeport about the fleet. Read-only tools only; auth is the
// global middleware's (a Bearer API token, read scope is enough: see scopeAllows).
// Stateless: no session id is minted and no event stream is offered, so GET (the
// older revisions' notification stream) and DELETE (their session end) answer 405,
// which the transport spec allows.
export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed: this MCP endpoint takes POST only (stateless, no event stream)' })
  }
  // refuse a huge body before buffering it (the real ones are a few hundred bytes)
  if (Number(getHeader(event, 'content-length') || 0) > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Request body too large' })
  }
  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const res = await handleMcpPost(raw, (n) => getHeader(event, n), homeportMcp, fleetSource())
  if (res.body === undefined) return sendNoContent(event, res.status)
  setResponseStatus(event, res.status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return JSON.stringify(res.body)
})
