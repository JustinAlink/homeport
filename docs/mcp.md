# Ask an AI assistant about your fleet (MCP)

homeport has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so an
AI assistant such as Claude can answer questions about your containers from live data:

- "What serves app.example.com?"
- "Which containers are unhealthy?"
- "What needs updating?"
- "What is reachable around the reverse proxy?"
- "Show me the last errors in the vaultwarden log."

The assistant only reads. It has no tool that starts, stops, updates or edits anything, and it
never sees container environments, settings, files, compose or `.env` contents, or backups.

## Connect

Open **Settings > Security & users > Connect an AI assistant (MCP)**. The panel shows the endpoint
URL, makes a read-only token with one click, and gives ready-to-paste config with that token
filled in. By hand:

- **Endpoint:** `https://<your homeport>/api/mcp`
- **Transport:** Streamable HTTP
- **Auth:** `Authorization: Bearer <token>`, an API token from Settings > Security & users > API
  tokens. Use a **read-only** token: it is all the tools need, and one that leaks from a config
  file cannot change anything.

### Claude Code

```sh
claude mcp add --transport http homeport https://homeport.example.com/api/mcp \
  --header "Authorization: Bearer hp_..."
```

Add `--scope user` to have it in every project.

### Claude Desktop

Claude Desktop reaches a server on your own network through the
[`mcp-remote`](https://github.com/geelen/mcp-remote) bridge (needs Node.js). In
`claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "homeport": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://homeport.example.com/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer hp_..." }
    }
  }
}
```

The header goes through `env` because some clients split arguments on spaces. Add `"--allow-http"`
to `args` if homeport is served over plain HTTP, and only on a network you trust. Custom
connectors (Settings, Connectors) connect from Anthropic's servers, so they only reach a homeport
that is on the internet.

### Other clients

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "homeport": {
      "type": "http",
      "url": "https://homeport.example.com/api/mcp",
      "headers": { "Authorization": "Bearer hp_..." }
    }
  }
}
```

Any client that speaks Streamable HTTP needs only the URL and the header. To check the endpoint
from a shell:

```sh
curl -s https://homeport.example.com/api/mcp \
  -H "Authorization: Bearer hp_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

| Tool | Answers | Arguments |
| --- | --- | --- |
| `list_services` | Every container (and systemd unit, when shown): state, health, image, group, domains, published ports, CPU and memory, id. Also unreachable hosts and proxy routes that point at nothing. | `status`: all, running, stopped or problem (unhealthy, restarting, dead, or exited with an error code); `query`: text filter |
| `get_service` | One container in full: state, image and update status, compose project, ports, networks, domains and how the proxy reaches them, usage, exposure findings with the fix, recent alerts. | `service`: name, id or domain |
| `find_domain` | Which container serves a domain, through which proxy and how (container name or published port), HTTPS, and what an anonymous visitor gets (a login, a sign-in portal, the open app, no answer). Wildcard routes and full URLs work. | `domain`; `probe` (default true) |
| `list_updates` | What has a new image for its tag, a newer version tag, or a rebuilt pinned tag; how many are up to date, unchecked or failed. Answers from homeport's last registry check. | none |
| `exposure_report` | The exposure report (the Exposure page): findings worst first (reachable around the proxy, controls Docker, admin port or database open, no HTTPS, plain HTTP not redirected, open ports), each with why and the fix. Accepted findings listed apart. | `level`: attention (default), all or one level; `probe` (default false) |
| `recent_alerts` | The newest alert events: down, unhealthy, recovered, domain down, update found or applied. | `limit` (1 to 100); `service`: name filter |
| `get_logs` | The last lines of a container's log, with timestamps, stderr marked. Only offered while logs are on (`HOMEPORT_LOGS` is not `false`). | `service`; `lines` (1 to 500); `contains`: text filter over the last 2000 lines |

Arguments that name a service take a container name, a homeport service id or one of its
domains; an ambiguous name answers with the candidates and their ids. Every answer is compact text
capped at 40,000 characters, so a large fleet cannot flood the conversation.

## Security

- **Same reach as a read-only token.** Every tool reads data a read-only token can already `GET`
  from the API. Read tokens and viewer accounts may `POST` to exactly `/api/mcp` and nowhere else
  (the protocol sends every question as a POST); a read token still cannot POST, PUT or DELETE any
  other path. Full tokens work too, but give the assistant more than it can use.
- **Always on when there is a login.** It exposes nothing new, so there is no switch: without a
  token the endpoint answers `401` like the rest of the API. To cut an assistant off, revoke its
  token. If homeport runs without a login, the endpoint is as open as the rest of the API.
- **Browsers are refused.** The cross-origin guard still applies: a POST from another site's page
  gets `403` (MCP clients are not browsers and send no `Origin`).
- **Behind forward-auth or an access list?** The assistant cannot pass a sign-in portal or a
  Basic Auth prompt. Let `/api/mcp` through the portal (homeport checks the token itself), or
  connect to homeport directly on your network.
- **Probes.** `find_domain`, and `exposure_report` with `probe: true`, send one request to each
  domain involved (cached for a minute, 4 second timeout), the same check the exposure page runs.

## Protocol details

- One stateless endpoint for both protocol eras. Modern clients (revision `2026-07-28`) send their
  version and capabilities in each request's `_meta` with the matching `MCP-Protocol-Version`,
  `Mcp-Method` and `Mcp-Name` headers; `server/discover`, `tools/list` and `tools/call` are
  served. Older clients (`2025-03-26` to `2025-11-25`) use `initialize`, `ping`, `tools/list` and
  `tools/call`. No session id is issued.
- Answers are single JSON objects (no event stream). `GET` and `DELETE` answer `405`.
- Errors: `400` with `-32700` (not JSON), `-32600` (not a JSON-RPC request, or a batch),
  `-32020` (a header disagrees with the body), `-32022` (unsupported version, with the supported
  list), `-32602` (missing `_meta` capabilities); `404` with `-32601` for an unknown method in a
  modern request (`200` for older clients, who read a 404 as "no MCP here"). An unknown tool is
  `-32602`; a bad tool argument or a failed lookup (Docker unreachable) is a tool result with
  `isError: true`, so the assistant can correct itself.

## Demo mode

With `HOMEPORT_DEMO=true` the tools answer from the demo fleet: try "what serves
qbit.example.com?" (it is reachable around the proxy) or "what needs updating?".
