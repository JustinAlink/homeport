<template>
  <div class="space-y-4">
    <p class="text-xs leading-relaxed text-slate-500">
      Let an AI assistant such as Claude ask homeport about this fleet: "what serves app.example.com?", "which containers are
      unhealthy?", "what needs updating?". It speaks the Model Context Protocol and gets read-only tools: it cannot start,
      stop or change anything, and never sees container environments, settings or files.
    </p>

    <!-- where -->
    <div>
      <label :for="`${uid}-url`" class="field-label">Endpoint</label>
      <div class="flex max-w-xl items-center gap-1.5">
        <input :id="`${uid}-url`" readonly :value="endpoint" class="input font-mono text-[12.5px]" @focus="selectAll" />
        <CopyButton :text="endpoint" label="endpoint URL" />
      </div>
      <p class="field-hint">Streamable HTTP. The assistant authenticates with <code>Authorization: Bearer &lt;token&gt;</code>.</p>
    </div>

    <div v-if="caps.loginDisabled" class="callout callout-warn">
      <Icon name="alert" />
      <span>homeport runs without a login, so this endpoint answers anyone who can reach it, like the rest of the API.</span>
    </div>

    <!-- which token -->
    <div class="callout callout-info">
      <Icon name="lock" />
      <div class="min-w-0 flex-1">
        <p>
          Give the assistant a <b class="text-slate-100">read-only token</b>: it is all the tools need, and a token that leaks from a
          config file cannot change anything.
        </p>
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <button v-if="!token" type="button" class="btn btn-sm" :disabled="busy || caps.viewer" @click="mint">
            <Icon name="plus" /> {{ busy ? 'Creating…' : 'Create a read-only token for it' }}
          </button>
          <span v-else class="badge badge-ok"><Icon name="check" class="h-3 w-3" />token created and filled in below</span>
          <span class="text-[11.5px] text-slate-500">{{ token ? 'Copy the snippet now: the token is stored hashed and not shown again.' : 'or paste one you made under API tokens.' }}</span>
        </div>
      </div>
    </div>

    <!-- how, per client -->
    <div>
      <div class="segmented max-w-full overflow-x-auto" role="group" aria-label="Assistant">
        <button v-for="c in CLIENTS" :key="c.id" type="button" :aria-pressed="client === c.id" @click="client = c.id">{{ c.label }}</button>
      </div>

      <div class="mt-3 space-y-2">
        <template v-for="sn in snippets" :key="sn.label">
          <p class="text-xs leading-relaxed text-slate-400">
            <template v-for="(part, i) in codeParts(sn.intro)" :key="i"><code v-if="part.code">{{ part.text }}</code><template v-else>{{ part.text }}</template></template>
          </p>
          <!-- the copy button sits in a title bar, not over the code: long lines scroll under it on a phone -->
          <div class="overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/70">
            <div class="flex items-center justify-between gap-2 border-b border-white/[0.06] py-1 pl-3 pr-1.5 text-[11px] text-slate-500">
              <span>{{ sn.label }}</span>
              <CopyButton :text="sn.text" :label="sn.label" />
            </div>
            <pre class="max-w-full overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-slate-200" :aria-label="sn.label" tabindex="0">{{ sn.text }}</pre>
          </div>
        </template>
        <p v-if="client === 'claude-desktop'" class="text-[11.5px] leading-relaxed text-slate-500">
          Custom connectors under Settings, Connectors connect from Anthropic's servers instead, so they only reach a homeport that is on the internet.
          <template v-if="plainHttp"> <code>--allow-http</code> is there because this address is not HTTPS: keep that to a network you trust.</template>
        </p>
      </div>
    </div>

    <!-- what it can answer -->
    <details class="group/tools">
      <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        What the assistant can ask <Icon name="arrow-right" class="h-3 w-3 transition-transform group-open/tools:rotate-90" />
      </summary>
      <ul class="mt-2 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
        <li v-for="t in TOOLS" :key="t.name" class="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2" :class="t.name === 'get_logs' && !caps.logs ? 'opacity-60' : ''">
          <code class="self-start shrink-0 font-mono text-[11.5px] text-slate-200">{{ t.name }}</code>
          <span class="text-slate-500">{{ t.text }}<template v-if="t.name === 'get_logs' && !caps.logs"> (off: logs are disabled)</template></span>
        </li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
// "Connect an AI assistant": the MCP endpoint's URL, a one-click read-only token,
// and ready-to-paste config for the common clients. The snippets carry the token
// minted here, since it is shown only once; otherwise a placeholder.

const { caps } = useCapabilities()
const toast = useToast()
const uid = useId()

const CLIENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'other', label: 'Other clients' },
] as const
type ClientId = (typeof CLIENTS)[number]['id']
const client = ref<ClientId>('claude-code')

const TOOLS = [
  { name: 'list_services', text: 'containers, state, health, ports, usage; or only the ones with a problem' },
  { name: 'get_service', text: 'one container in full, with its findings and alerts' },
  { name: 'find_domain', text: 'which container serves a domain, through which proxy, with HTTPS and login' },
  { name: 'list_updates', text: 'what has a new image or a newer version' },
  { name: 'exposure_report', text: 'what is reachable around the proxy, with the fix' },
  { name: 'recent_alerts', text: 'the latest down, unhealthy and recovered events' },
  { name: 'get_logs', text: 'the last lines of a container log, optionally filtered' },
]

// The browser's own address is the one the assistant should use too (it reaches the
// same proxy). Read after mount: the server render has no window.
const origin = ref('')
onMounted(() => (origin.value = window.location.origin))
const endpoint = computed(() => `${origin.value || 'https://homeport.example.com'}/api/mcp`)
const plainHttp = computed(() => endpoint.value.startsWith('http://'))
const selectAll = (e: FocusEvent) => (e.target as HTMLInputElement).select()

const token = ref('')
const busy = ref(false)
const tok = computed(() => token.value || '<read-only-token>')

// ApiTokens.vue reloads its list when this changes, so the new token shows up there too
const tokensRev = useState('hp:tokens-rev', () => 0)

async function mint() {
  if (busy.value) return
  busy.value = true
  try {
    const r = await $fetch<{ token: string }>('/api/tokens', { method: 'POST', body: { name: 'AI assistant (MCP)', scope: 'read' } })
    token.value = r.token
    tokensRev.value++
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not create a token'))
  } finally {
    busy.value = false
  }
}

const claudeCode = computed(() => `claude mcp add --transport http homeport ${endpoint.value} \\\n  --header "Authorization: Bearer ${tok.value}"`)

// The env indirection is mcp-remote's documented way round clients that split args
// on spaces (Claude Desktop on Windows): the header value itself has a space.
const claudeDesktop = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        homeport: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpoint.value, '--header', 'Authorization:${AUTH_HEADER}', ...(plainHttp.value ? ['--allow-http'] : [])],
          env: { AUTH_HEADER: `Bearer ${tok.value}` },
        },
      },
    },
    null,
    2,
  ),
)

const vscode = computed(() =>
  JSON.stringify({ servers: { homeport: { type: 'http', url: endpoint.value, headers: { Authorization: `Bearer ${tok.value}` } } } }, null, 2),
)

const curl = computed(
  () =>
    `curl -s ${endpoint.value} \\\n  -H "Authorization: Bearer ${tok.value}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
)

// `backticks` in an intro render as code (codeParts, utils/exposureText.ts)
const snippets = computed(() => {
  if (client.value === 'claude-code')
    return [{ label: 'Claude Code command', intro: 'Run in a terminal. Add `--scope user` to have it in every project, not just this folder.', text: claudeCode.value }]
  if (client.value === 'claude-desktop')
    return [
      {
        label: 'Claude Desktop config',
        intro:
          'Paste into `claude_desktop_config.json` (Settings, Developer, Edit Config) and restart Claude. The `mcp-remote` bridge (needs Node.js) connects from your computer, so a homeport on your LAN works.',
        text: claudeDesktop.value,
      },
    ]
  return [
    { label: 'VS Code config', intro: 'VS Code (`.vscode/mcp.json`); other clients take the same URL and header.', text: vscode.value },
    { label: 'Test with curl', intro: 'Check the endpoint from a shell: it lists the tools.', text: curl.value },
  ]
})
</script>
