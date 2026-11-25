// The MCP (Model Context Protocol) endpoint's protocol layer: JSON-RPC 2.0 over
// Streamable HTTP, kept pure so the dispatcher is unit-testable without Nitro.
//
// One stateless endpoint serves both eras of the protocol, because clients are
// mid-migration and an assistant that cannot connect is worth nothing:
//  - modern (2026-07-28 and later): no handshake. Every request carries its protocol
//    version and client capabilities in params._meta, mirrored in the
//    MCP-Protocol-Version / Mcp-Method / Mcp-Name headers, which must match the body.
//  - legacy (2025-03-26 to 2025-11-25): `initialize` first, then plain requests with the
//    negotiated version in MCP-Protocol-Version. Sessions were optional in those
//    revisions, so none is minted: every POST stands on its own.
//
// Hand-written rather than the official SDK: homeport needs five methods (discover,
// initialize, ping, tools/list, tools/call) and answers each with one JSON object. The
// v1 SDK brings express, hono, ajv and jose for transport plumbing Nitro already does;
// v2 brings zod and a 1.4 MB schema package. This file is the whole protocol surface.

import type { HeaderGetter } from './csrf-core.ts'

export const MODERN_VERSIONS: readonly string[] = ['2026-07-28']
export const LEGACY_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26']
/** Newest first: what server/discover and the version error advertise. */
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]
/** The spec lets a server read a request without MCP-Protocol-Version as the first Streamable HTTP revision. */
const HEADERLESS_VERSION = '2025-03-26'

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_VERSION: -32022,
} as const

/** A request body bigger than this is refused before parsing: the largest real one is a few hundred bytes. */
export const MAX_BODY_BYTES = 64 * 1024
/** Tool output cap: a model reads every character, and a runaway answer crowds out the conversation. */
export const MAX_TOOL_TEXT = 40_000

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER = 'io.modelcontextprotocol/serverInfo'


export interface ToolResult {
  text: string
  /** A failure the model can act on (bad argument, nothing found to match): reported in the result, not as a protocol error. */
  isError?: boolean
}

export interface McpTool<C> {
  name: string
  title: string
  description: string
  inputSchema: JsonSchemaObject
  annotations?: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: C) => Promise<ToolResult> | ToolResult
}

export interface McpServer<C> {
  name: string
  title: string
  version: string
  instructions: string
  /** The tools on offer for this request, in a fixed order (a capability switched off drops its tool). */
  tools: (ctx: C) => McpTool<C>[]
}

export interface McpResponse {
  status: number
  /** Absent for 202 Accepted, which has no body. */
  body?: unknown
}

/** The subset of JSON Schema the tools use, which is also all validateArgs understands. */
export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, JsonSchemaProp>
  required?: string[]
  additionalProperties: false
}
export interface JsonSchemaProp {
  type: 'string' | 'integer' | 'boolean'
  description: string
  enum?: string[]
  minimum?: number
  maximum?: number
  maxLength?: number
  default?: unknown
}

type Id = string | number
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// Error responses carry the request id when it could be read. When it could not
// (unparseable body, a batch), the current spec's schema leaves `id` out.
function rpcError(id: Id | undefined, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), error: { code, message, ...(data !== undefined ? { data } : {}) } }
}
const fail = (status: number, id: Id | undefined, code: number, message: string, data?: unknown): McpResponse => ({ status, body: rpcError(id, code, message, data) })
const ok = (id: Id, result: unknown): McpResponse => ({ status: 200, body: { jsonrpc: '2.0', id, result } })

/** Echo a client-supplied value in an error message without letting it grow the response. */
const clip = (v: unknown, n = 64) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)
  return s.length > n ? `${s.slice(0, n)}...` : s
}

/**
 * Header values that are not plain ASCII arrive as `=?base64?...?=` (Streamable HTTP,
 * Value Encoding). Returns null for a missing or undecodable header.
 */
export function decodeHeaderValue(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(t)
  if (!m) return t
  try {
    return Buffer.from(m[1], 'base64').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Check tool arguments against the tool's schema. Returns a sentence the model can
 * act on, or null when they are fine. Unknown keys are refused so a misspelt filter
 * does not silently return everything.
 */
export function validateArgs(schema: JsonSchemaObject, args: Obj): string | null {
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) {
      const known = Object.keys(schema.properties)
      return `Unknown argument "${clip(key, 40)}". ${known.length ? `This tool takes: ${known.join(', ')}.` : 'This tool takes no arguments.'}`
    }
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === '') return `Missing required argument "${key}".`
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = args[key]
    if (v === undefined || v === null) continue
    if (prop.type === 'string') {
      if (typeof v !== 'string') return `"${key}" must be a string.`
      if (prop.maxLength !== undefined && v.length > prop.maxLength) return `"${key}" is longer than ${prop.maxLength} characters.`
      if (prop.enum && !prop.enum.includes(v)) return `"${key}" must be one of: ${prop.enum.join(', ')}.`
    } else if (prop.type === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) return `"${key}" must be a whole number.`
      if (prop.minimum !== undefined && v < prop.minimum) return `"${key}" must be at least ${prop.minimum}.`
      if (prop.maximum !== undefined && v > prop.maximum) return `"${key}" must be at most ${prop.maximum}.`
    } else if (prop.type === 'boolean') {
      if (typeof v !== 'boolean') return `"${key}" must be true or false.`
    }
  }
  return null
}

/** Cut an over-long answer at a line break and say so, so the model knows to narrow the question. */
export function capText(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('\n', max)
  const head = text.slice(0, cut > max * 0.8 ? cut : max)
  return `${head}\n[cut at ${max} characters: narrow the request (a filter, a single service, fewer lines) to see the rest]`
}

function toolList<C>(server: McpServer<C>, ctx: C) {
  return server.tools(ctx).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }))
}

async function callTool<C>(id: Id, params: Obj, server: McpServer<C>, ctx: C): Promise<{ error: McpResponse } | { result: Obj }> {
  const name = params.name
  if (typeof name !== 'string' || !name) return { error: fail(200, id, RPC.INVALID_PARAMS, 'tools/call needs params.name (a tool name from tools/list)') }
  const args = params.arguments ?? {}
  if (!isObj(args)) return { error: fail(200, id, RPC.INVALID_PARAMS, 'params.arguments must be an object') }
  const tool = server.tools(ctx).find((t) => t.name === name)
  if (!tool) return { error: fail(200, id, RPC.INVALID_PARAMS, `Unknown tool: ${clip(name)}`) }
  const problem = validateArgs(tool.inputSchema, args)
  if (problem) return { result: { content: [{ type: 'text', text: problem }], isError: true } }
  try {
    const r = await tool.run(args, ctx)
    return { result: { content: [{ type: 'text', text: capText(r.text) }], isError: !!r.isError } }
  } catch (e: any) {
    // Docker unreachable, a registry cache that will not load: the model should hear
    // it as a failed lookup it can report, not a broken server.
    return { result: { content: [{ type: 'text', text: `homeport could not answer: ${clip(e?.message || String(e), 300)}` }], isError: true } }
  }
}

/**
 * Handle one POST to the MCP endpoint: the raw body plus a header getter in, an HTTP
 * status and JSON body out. Status codes follow the transport spec: 202 for an
 * accepted notification, 400 for a malformed request, a header that disagrees with
 * the body or an unsupported version, 404 for an unknown method (modern requests).
 * Everything that reached a method answers 200, tool failures included.
 */
export async function handleMcpPost<C>(raw: string, header: HeaderGetter, server: McpServer<C>, ctx: C): Promise<McpResponse> {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return fail(413, undefined, RPC.INVALID_REQUEST, `Request body over ${MAX_BODY_BYTES} bytes`)
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return fail(400, undefined, RPC.PARSE_ERROR, 'Parse error: the body is not JSON')
  }
  // JSON-RPC batches left MCP in 2025-06-18; one message per POST is the rule now.
  if (Array.isArray(msg)) return fail(400, undefined, RPC.INVALID_REQUEST, 'Batches are not supported: send one JSON-RPC message per POST')
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return fail(400, undefined, RPC.INVALID_REQUEST, 'Not a JSON-RPC 2.0 message')
  // This server never sends requests, so a client has no responses to send it.
  if (typeof msg.method !== 'string') return fail(400, undefined, RPC.INVALID_REQUEST, 'Expected a request or a notification (a "method")')
  const method = msg.method

  // A notification (no id) gets 202 and no body. The ones a client may send here
  // (notifications/initialized, notifications/cancelled) need no action: there is no
  // session to open and every answer is immediate.
  if (!('id' in msg)) return { status: 202 }
  const id = msg.id
  if (typeof id !== 'string' && typeof id !== 'number') return fail(400, undefined, RPC.INVALID_REQUEST, 'The request id must be a string or a number')
  if (msg.params !== undefined && !isObj(msg.params)) return fail(400, id, RPC.INVALID_REQUEST, 'params must be an object')
  const params: Obj = (msg.params as Obj | undefined) ?? {}
  const meta = isObj(params._meta) ? params._meta : undefined

  // The era is a property of the request: modern ones declare their version in _meta.
  if (meta && META_VERSION in meta) return modern(id, method, params, meta, header, server, ctx)
  return legacy(id, method, params, header, server, ctx)
}

async function modern<C>(id: Id, method: string, params: Obj, meta: Obj, header: HeaderGetter, server: McpServer<C>, ctx: C): Promise<McpResponse> {
  const version = meta[META_VERSION]
  // The headers exist so proxies can route without reading the body. A body that
  // says something else than its headers is refused, or the two could be played
  // against each other (Streamable HTTP, Server Validation).
  const hVersion = (header('mcp-protocol-version') ?? '').trim()
  if (!hVersion || hVersion !== version)
    return fail(400, id, RPC.HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version (${clip(hVersion || 'missing')}) must equal _meta protocolVersion (${clip(version)})`)
  const hMethod = (header('mcp-method') ?? '').trim()
  if (hMethod !== method) return fail(400, id, RPC.HEADER_MISMATCH, `Header mismatch: Mcp-Method (${clip(hMethod || 'missing')}) must equal the body's method (${clip(method)})`)
  if (method === 'tools/call') {
    const hName = decodeHeaderValue(header('mcp-name'))
    if (hName === null || hName !== params.name)
      return fail(400, id, RPC.HEADER_MISMATCH, `Header mismatch: Mcp-Name (${clip(hName ?? 'missing')}) must equal params.name (${clip(params.name)})`)
  }
  if (typeof version !== 'string' || !MODERN_VERSIONS.includes(version))
    return fail(400, id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: version })
  if (!isObj(meta[META_CAPS])) return fail(400, id, RPC.INVALID_PARAMS, `Missing _meta "${META_CAPS}" (required on every request)`)

  // every modern result says what it is and who answered (no session to remember it)
  const done = (result: Obj) => ok(id, { resultType: 'complete', ...result, _meta: { [META_SERVER]: { name: server.name, title: server.title, version: server.version } } })
  switch (method) {
    case 'server/discover':
      return done({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        instructions: server.instructions,
        // private: the answer sits behind a token, so shared caches must not keep it
        ttlMs: 300_000,
        cacheScope: 'private',
      })
    case 'tools/list':
      // a minute: switching the logs capability adds or removes get_logs
      return done({ tools: toolList(server, ctx), ttlMs: 60_000, cacheScope: 'private' })
    case 'tools/call': {
      const r = await callTool(id, params, server, ctx)
      return 'error' in r ? r.error : done(r.result)
    }
    default:
      // initialize and ping are legacy methods: a modern request naming them is unknown here
      return fail(404, id, RPC.METHOD_NOT_FOUND, `Method not found: ${clip(method)}`)
  }
}

async function legacy<C>(id: Id, method: string, params: Obj, header: HeaderGetter, server: McpServer<C>, ctx: C): Promise<McpResponse> {
  if (method === 'initialize') {
    const asked = params.protocolVersion
    if (typeof asked !== 'string') return fail(400, id, RPC.INVALID_PARAMS, 'initialize needs params.protocolVersion')
    // the lifecycle rule: answer with the client's version when supported, else the newest one we speak
    const version = LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0]
    return ok(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: server.name, title: server.title, version: server.version },
      instructions: server.instructions,
    })
  }
  // After initialize the client names the negotiated version on every request.
  const version = (header('mcp-protocol-version') ?? '').trim() || HEADERLESS_VERSION
  if (MODERN_VERSIONS.includes(version))
    return fail(400, id, RPC.HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version is ${version} but the body has no _meta "${META_VERSION}"`)
  if (!LEGACY_VERSIONS.includes(version)) return fail(400, id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: version })

  switch (method) {
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: toolList(server, ctx) })
    case 'tools/call': {
      const r = await callTool(id, params, server, ctx)
      return 'error' in r ? r.error : ok(id, r.result)
    }
    default:
      // 200, not 404: a legacy client reads a 404 as "no MCP endpoint here" and falls back to the old SSE transport
      return fail(200, id, RPC.METHOD_NOT_FOUND, `Method not found: ${clip(method)}`)
  }
}
