<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <div class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">⚓</div>
      <h1 class="text-xl font-semibold text-slate-100">Settings</h1>
    </header>

    <div
      v-if="loaded && !writable"
      class="mb-5 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300"
    >
      Settings storage isn't writable — mount a writable volume at <code>HOMEPORT_DATA_DIR</code> to save changes.
      You can still configure everything via environment variables.
    </div>

    <div v-if="loaded" class="gap-8 md:flex">
      <!-- section nav (sticky on desktop) -->
      <nav class="mb-4 hidden w-44 shrink-0 md:block">
        <ul class="sticky top-6 space-y-0.5 text-sm">
          <li v-for="s in sections" :key="s.id">
            <a
              :href="`#${s.id}`"
              class="block rounded-md px-2.5 py-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
              :class="active === s.id ? 'bg-white/5 text-accent-light' : ''"
              @click="active = s.id"
            >{{ s.label }}</a>
          </li>
        </ul>
      </nav>

      <form class="min-w-0 flex-1 space-y-8" @submit.prevent="save">
        <!-- first-run hint -->
        <div
          v-if="showProviderHint"
          class="rounded-md border border-sky-400/20 bg-sky-400/5 p-3 text-xs text-sky-200/90"
        >
          No reverse proxy is configured yet, so domains aren't mapped. Pick one under
          <a href="#proxy" class="underline">Reverse proxy</a>, or ignore this if you only want container status.
        </div>

      <!-- Docker connection -->
      <section :id="'docker'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Docker connection</h2>
        <p v-if="locked.docker" class="text-xs text-slate-500">Set by <code>DOCKER_HOST</code> — locked.</p>
        <div class="space-y-3" :class="locked.docker ? 'pointer-events-none opacity-50' : ''">
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.dockerMode" type="radio" value="local" /> Local socket / proxy
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.dockerMode" type="radio" value="ssh" /> Remote over SSH
          </label>
          <div v-if="form.dockerMode === 'ssh'" class="space-y-2 pl-6">
            <input v-model="form.dockerHost" :class="fieldCls" placeholder="ssh://user@host" />
            <input v-model="form.dockerSshKey" :class="fieldCls" placeholder="/ssh/id_ed25519  (key path, mounted read-only)" />
            <input
              v-model="form.dockerSshFingerprint"
              :class="[fieldCls, locked.dockerSshFingerprint ? 'pointer-events-none opacity-50' : '']"
              placeholder="SHA256:…  host key fingerprint (optional, recommended)"
            />
            <p class="text-[11px] text-slate-500">
              Pin the host key to reject a changed/spoofed server. Get it with
              <code>ssh-keyscan host | ssh-keygen -lf -</code>.
              <span v-if="locked.dockerSshFingerprint">Set by <code>DOCKER_SSH_FINGERPRINT</code> — locked.</span>
            </p>
          </div>
        </div>
        <p class="text-[11px] text-slate-500">
          This single connection is used when the multi-host list below is empty.
        </p>
        <TestButton label="Test Docker connection" :run="testDocker" />
      </section>

      <!-- Hosts (multi-host) -->
      <section :id="'hosts'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Hosts</h2>
        <p v-if="locked.hosts" class="text-xs text-slate-500">Set by <code>HOMEPORT_HOSTS</code> — locked.</p>
        <p class="text-xs text-slate-500">
          Watch more than one Docker host. Leave empty to use the single connection above.
        </p>
        <div class="space-y-4" :class="locked.hosts ? 'pointer-events-none opacity-50' : ''">
          <div
            v-for="(h, i) in form.hosts"
            :key="i"
            class="space-y-2 rounded-md border border-white/10 bg-ink-900/60 p-3"
          >
            <div class="flex items-center gap-2">
              <input v-model="h.name" :class="fieldCls" placeholder="Display name (e.g. vps-1)" />
              <button
                type="button"
                class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                @click="form.hosts.splice(i, 1)"
              >
                Remove
              </button>
            </div>
            <input v-model="h.dockerHost" :class="fieldCls" placeholder="ssh://user@host  or  tcp://host:2375  (empty = local socket)" />
            <div v-if="(h.dockerHost || '').startsWith('ssh://')" class="space-y-2 pl-3">
              <input v-model="h.dockerSshKey" :class="fieldCls" placeholder="/ssh/id_ed25519  (key path)" />
              <input v-model="h.sshFingerprint" :class="fieldCls" placeholder="SHA256:…  host key fingerprint (optional, recommended)" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <select v-model="h.domainProvider" :class="fieldCls">
                <option value="">Proxy: auto / none</option>
                <option value="npm">Nginx Proxy Manager</option>
                <option value="nginx">Nginx (plain)</option>
                <option value="traefik">Traefik (labels)</option>
                <option value="traefik-file">Traefik (file)</option>
                <option value="caddy">Caddy</option>
              </select>
              <input
                v-if="h.domainProvider === 'npm'"
                v-model="h.npmConfDir"
                :class="fieldCls"
                placeholder="NPM proxy_host dir"
              />
              <input
                v-else-if="h.domainProvider === 'nginx'"
                v-model="h.nginxConfDir"
                :class="fieldCls"
                placeholder="Nginx confs dir/file"
              />
              <input
                v-else-if="h.domainProvider === 'traefik-file'"
                v-model="h.traefikFilePath"
                :class="fieldCls"
                placeholder="Traefik config file/dir"
              />
              <input
                v-else-if="h.domainProvider === 'caddy'"
                v-model="h.caddyfilePath"
                :class="fieldCls"
                placeholder="Caddyfile path"
              />
            </div>
          </div>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-accent/40 hover:text-accent"
            @click="addHost"
          >
            + Add host
          </button>
        </div>
      </section>

      <!-- Reverse proxy -->
      <section :id="'proxy'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Reverse proxy (domain mapping)</h2>
        <p v-if="locked.domainProvider" class="text-xs text-slate-500">Set by <code>DOMAIN_PROVIDER</code> — locked.</p>
        <div class="space-y-3" :class="locked.domainProvider ? 'pointer-events-none opacity-50' : ''">
          <select v-model="form.domainProvider" :class="fieldCls">
            <option value="">Auto-detect</option>
            <option value="npm">Nginx Proxy Manager</option>
            <option value="nginx">Nginx (plain)</option>
            <option value="traefik">Traefik (labels)</option>
            <option value="traefik-file">Traefik (file)</option>
            <option value="caddy">Caddy</option>
          </select>
          <input
            v-if="form.domainProvider === 'npm' || (form.domainProvider === '' && form.npmConfDir)"
            v-model="form.npmConfDir"
            :class="fieldCls"
            placeholder="NPM proxy_host dir (in-container path)"
          />
          <input
            v-if="form.domainProvider === 'nginx'"
            v-model="form.nginxConfDir"
            :class="fieldCls"
            placeholder="Nginx confs dir or file (e.g. /nginx/sites-enabled)"
          />
          <input
            v-if="form.domainProvider === 'traefik-file'"
            v-model="form.traefikFilePath"
            :class="fieldCls"
            placeholder="Traefik dynamic config file/dir (YAML or TOML)"
          />
          <input
            v-if="form.domainProvider === 'caddy'"
            v-model="form.caddyfilePath"
            :class="fieldCls"
            placeholder="Caddyfile path (in-container)"
          />
        </div>
        <TestButton label="Test provider" :run="testProvider" />
      </section>

      <!-- Proxy management (write side) -->
      <section :id="'proxy-admin'"  v-if="form.allowProxyAdmin" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Proxy management</h2>
        <p class="text-xs text-slate-500">
          Credentials homeport uses to create/edit domains. Stored in <code>settings.json</code> on the
          data volume — set its file permissions accordingly.
        </p>

        <div v-if="form.domainProvider === 'npm' || form.domainProvider === ''" class="space-y-2">
          <p v-if="locked.npmApiUrl" class="text-xs text-slate-500">Set by <code>HOMEPORT_NPM_API_URL</code> — locked.</p>
          <input v-model="form.npmApiUrl" :class="fieldCls" placeholder="NPM API URL (e.g. http://npm:81)" />
          <input v-model="form.npmApiIdentity" :class="fieldCls" placeholder="NPM email / identity" />
          <input v-model="form.npmApiSecret" type="password" :class="fieldCls" placeholder="NPM password" />
        </div>
        <div v-if="form.domainProvider === 'caddy'" class="space-y-2">
          <input v-model="form.caddyAdminUrl" :class="fieldCls" placeholder="Caddy admin API (e.g. http://caddy:2019)" />
          <p class="text-[11px] text-slate-500">The admin API is root-of-proxy — keep it on a private network, never published.</p>
        </div>
        <p v-if="form.domainProvider === 'traefik-file'" class="text-[11px] text-slate-500">
          Traefik file admin writes a <code>homeport.yml</code> in the dynamic-config dir (or only
          <code>homeport-*</code> keys in a single file). Mount it <strong>read-write</strong>.
        </p>

        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="proxyTesting"
            class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            @click="testProxy"
          >{{ proxyTesting ? 'Testing…' : 'Test connection' }}</button>
          <span v-if="proxyMsg" class="text-[11px]" :class="proxyOk ? 'text-accent-light' : 'text-red-400'">{{ proxyMsg }}</span>
        </div>
      </section>

      <!-- Capabilities (tiered opt-in) -->
      <section :id="'capabilities'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Capabilities</h2>
        <p class="text-xs text-slate-500">
          homeport is read-only by default. Each capability is its own opt-in; the hint shows what the
          docker-socket-proxy must allow for it.
        </p>
        <div class="space-y-2.5">
          <label
            v-for="c in capabilityToggles"
            :key="c.key"
            class="flex items-start gap-2 text-sm text-slate-200"
            :class="locked[c.lock] ? 'pointer-events-none opacity-50' : ''"
          >
            <input v-model="(form as any)[c.key]" type="checkbox" class="mt-0.5" />
            <span>
              {{ c.label }}
              <span class="block text-[11px] text-slate-500">
                {{ c.hint }}<template v-if="locked[c.lock]"> · set by <code>{{ c.env }}</code> — locked</template>
              </span>
            </span>
          </label>
        </div>
      </section>

      <!-- Uptime -->
      <section :id="'uptime'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Uptime</h2>
        <p v-if="locked.pingEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_PING</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.pingEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.pingEnabled" type="checkbox" />
          HTTP-ping mapped domains
          <span class="text-[11px] text-slate-500">(up/down dot on each domain)</span>
        </label>
      </section>

      <!-- Host services -->
      <section :id="'systemd'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Host services</h2>
        <p v-if="locked.systemdEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_SYSTEMD</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.systemdEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.systemdEnabled" type="checkbox" />
          Show systemd services
          <span class="text-[11px] text-slate-500">(needs <code>systemctl</code> access — host install or mounted)</span>
        </label>
      </section>

      <!-- Monitoring -->
      <section :id="'monitoring'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Monitoring</h2>
        <p v-if="locked.collectorInterval" class="text-xs text-slate-500">
          Interval set by <code>HOMEPORT_COLLECTOR_INTERVAL</code> — locked.
        </p>
        <label class="block text-sm text-slate-200">
          Background collector interval (seconds)
          <input
            v-model.number="form.collectorInterval"
            type="number"
            min="10"
            :class="[fieldCls, 'mt-1', locked.collectorInterval ? 'pointer-events-none opacity-50' : '']"
          />
          <span class="text-[11px] text-slate-500">
            How often homeport snapshots the fleet in the background to feed history and alerts. Minimum 10.
          </span>
        </label>
        <p v-if="locked.historyEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_HISTORY</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.historyEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.historyEnabled" type="checkbox" />
          Keep CPU/RAM history
          <span class="text-[11px] text-slate-500">(graphs survive refresh/restart; stored under the data dir)</span>
        </label>
      </section>

      <!-- Alerts & notifications -->
      <section :id="'alerts'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Alerts &amp; notifications</h2>
        <p v-if="locked.alerts" class="text-xs text-slate-500">Set by <code>HOMEPORT_ALERTS</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.alerts ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.alertsEnabled" type="checkbox" />
          Notify on service state changes
        </label>

        <div v-if="form.alertsEnabled" class="space-y-4 border-l border-white/5 pl-3">
          <div class="flex flex-wrap gap-4 text-sm text-slate-300">
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.down" type="checkbox" /> Down</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.unhealthy" type="checkbox" /> Unhealthy</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.recovered" type="checkbox" /> Recovered</label>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="block text-xs text-slate-400">
              Debounce (samples)
              <input v-model.number="form.alertDebounceSamples" type="number" min="1" :class="[fieldCls, 'mt-1']" />
            </label>
            <label class="block text-xs text-slate-400">
              Re-notify cooldown (seconds)
              <input v-model.number="form.alertCooldownSec" type="number" min="0" :class="[fieldCls, 'mt-1']" />
            </label>
          </div>

          <div class="space-y-3">
            <p class="text-xs text-slate-500">Webhook channels (Discord / Slack / ntfy / custom). Add <code>hub.noalert=true</code> on a container to exclude it.</p>
            <div
              v-for="(ch, i) in form.alertChannels"
              :key="i"
              class="space-y-2 rounded-md border border-white/10 bg-ink-900/60 p-3"
            >
              <div class="flex items-center gap-2">
                <input v-model="ch.name" :class="fieldCls" placeholder="Channel name" />
                <select v-model="ch.preset" :class="[fieldCls, 'max-w-[8rem]']">
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="ntfy">ntfy</option>
                  <option value="custom">Custom</option>
                </select>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                  @click="form.alertChannels.splice(i, 1)"
                >
                  Remove
                </button>
              </div>
              <input v-model="ch.url" :class="fieldCls" placeholder="Webhook URL (https://…)" />
              <textarea
                v-if="ch.preset === 'custom'"
                v-model="ch.template"
                :class="[fieldCls, 'font-mono text-xs']"
                rows="2"
                placeholder='{"text":"{{text}}"}  — placeholders: {{name}} {{kind}} {{host}} {{from}} {{to}}'
              />
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-accent/40 hover:text-accent"
                @click="addChannel"
              >
                + Add channel
              </button>
              <button
                type="button"
                :disabled="testing || !form.alertChannels.length"
                class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
                @click="sendTest"
              >
                {{ testing ? 'Sending…' : 'Send test' }}
              </button>
              <span v-if="testMsg" class="text-[11px]" :class="testOk ? 'text-accent-light' : 'text-red-400'">{{ testMsg }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Appearance -->
      <section :id="'appearance'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Appearance</h2>
        <p v-if="locked.remoteIcons" class="text-xs text-slate-500">Set by <code>HOMEPORT_REMOTE_ICONS</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.remoteIcons ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.remoteIcons" type="checkbox" />
          Fetch app logos from the dashboard-icons CDN
          <span class="text-[11px] text-slate-500">(off = offline monograms / your own icon URLs only)</span>
        </label>
      </section>

      <!-- Account -->
      <section :id="'account'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Account</h2>
        <p v-if="caps.passwordEnvLocked" class="text-xs text-slate-500">
          The admin password is set via <code>HOMEPORT_ADMIN_PASSWORD</code> — change it there.
        </p>
        <div v-else class="max-w-sm space-y-2">
          <input v-model="pw.current" type="password" :class="fieldCls" placeholder="Current password" autocomplete="current-password" />
          <input v-model="pw.next" type="password" :class="fieldCls" placeholder="New password" autocomplete="new-password" />
          <input v-model="pw.confirm" type="password" :class="fieldCls" placeholder="Confirm new password" autocomplete="new-password" />
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="pwBusy"
              class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              @click="changePassword"
            >{{ pwBusy ? 'Saving…' : 'Change password' }}</button>
            <span v-if="pwMsg" class="text-[11px]" :class="pwOk ? 'text-accent-light' : 'text-red-400'">{{ pwMsg }}</span>
          </div>
        </div>
      </section>

      <div class="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-white/5 bg-ink-950/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="submit"
          :disabled="busy || !writable"
          class="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-50"
        >
          {{ busy ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="msg" class="text-xs" :class="msgOk ? 'text-accent-light' : 'text-red-400'">{{ msg }}</span>
      </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const fieldCls =
  'w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50'

const loaded = ref(false)
const writable = ref(true)
const locked = ref<Record<string, boolean>>({})
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)

// section anchor nav
const active = ref('docker')
const sections = computed(() =>
  [
    { id: 'docker', label: 'Docker connection' },
    { id: 'hosts', label: 'Hosts' },
    { id: 'proxy', label: 'Reverse proxy' },
    ...(form.allowProxyAdmin ? [{ id: 'proxy-admin', label: 'Proxy management' }] : []),
    { id: 'capabilities', label: 'Capabilities' },
    { id: 'uptime', label: 'Uptime' },
    { id: 'systemd', label: 'Host services' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'alerts', label: 'Alerts' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'account', label: 'Account' },
  ],
)

const { caps, load: loadCaps } = useCapabilities()

// change password
const pw = reactive({ current: '', next: '', confirm: '' })
const pwBusy = ref(false)
const pwMsg = ref('')
const pwOk = ref(false)
async function changePassword() {
  if (pw.next !== pw.confirm) {
    pwOk.value = false
    pwMsg.value = 'New passwords do not match'
    return
  }
  pwBusy.value = true
  pwMsg.value = ''
  try {
    await $fetch('/api/account/password', { method: 'POST', body: { current: pw.current, password: pw.next } })
    pwOk.value = true
    pwMsg.value = 'Password changed.'
    pw.current = pw.next = pw.confirm = ''
  } catch (e: any) {
    pwOk.value = false
    pwMsg.value = e?.statusMessage || 'Could not change password'
  } finally {
    pwBusy.value = false
  }
}

const showProviderHint = computed(
  () => loaded.value && !form.domainProvider && !form.npmConfDir && !form.caddyfilePath && !form.nginxConfDir && !form.traefikFilePath,
)

// connection tests (shared TestButton)
async function testDocker() {
  const r = await $fetch<{ hosts: { name: string; ok: boolean; message: string }[] }>('/api/test/docker', { method: 'POST' })
  const ok = r.hosts.every((h) => h.ok)
  return { ok, message: r.hosts.map((h) => `${h.name}: ${h.message}`).join(' · ') }
}
async function testProvider() {
  const r = await $fetch<{ ok: boolean; provider: string | null; count?: number; samples?: string[]; message?: string }>('/api/test/provider', { method: 'POST' })
  return {
    ok: r.ok,
    message: r.ok ? `${r.provider}: ${r.count} route(s)${r.samples?.length ? ' · ' + r.samples.join(', ') : ''}` : r.message || 'no provider',
  }
}

const form = reactive({
  dockerMode: 'local',
  dockerHost: '',
  dockerSshKey: '',
  dockerSshFingerprint: '',
  domainProvider: '',
  npmConfDir: '',
  caddyfilePath: '',
  nginxConfDir: '',
  traefikFilePath: '',
  npmApiUrl: '',
  npmApiIdentity: '',
  npmApiSecret: '',
  caddyAdminUrl: '',
  allowControl: false,
  logsEnabled: true,
  updateCheckEnabled: false,
  allowUpdates: false,
  allowStacks: false,
  allowTerminal: false,
  allowProxyAdmin: false,
  pingEnabled: true,
  systemdEnabled: false,
  remoteIcons: true,
  collectorInterval: 30,
  historyEnabled: true,
  alertsEnabled: false,
  alertTransitions: { down: true, unhealthy: true, recovered: false },
  alertDebounceSamples: 3,
  alertCooldownSec: 3600,
  alertChannels: [] as ChannelRow[],
  hosts: [] as HostRow[],
})

// Tiered capability toggles + the socket-proxy permissions each one needs.
const capabilityToggles = [
  { key: 'logsEnabled', lock: 'logsEnabled', env: 'HOMEPORT_LOGS', label: 'Container logs viewer', hint: 'read-tier — already covered by CONTAINERS=1 (on by default)' },
  { key: 'allowControl', lock: 'allowControl', env: 'HOMEPORT_ALLOW_CONTROL', label: 'Start / stop / restart buttons', hint: 'needs POST=1 on the socket proxy' },
  { key: 'updateCheckEnabled', lock: 'updateCheckEnabled', env: 'HOMEPORT_UPDATE_CHECK', label: 'Check for image updates', hint: 'needs DISTRIBUTION=1 (read-only registry digests)' },
  { key: 'allowUpdates', lock: 'allowUpdates', env: 'HOMEPORT_ALLOW_UPDATES', label: 'Apply image updates (pull + recreate)', hint: 'needs IMAGES=1 POST=1' },
  { key: 'allowStacks', lock: 'allowStacks', env: 'HOMEPORT_ALLOW_STACKS', label: 'Compose stack management', hint: 'needs POST=1 CONTAINERS=1 IMAGES=1 NETWORKS=1 VOLUMES=1 + a mounted stacks dir' },
  { key: 'allowTerminal', lock: 'allowTerminal', env: 'HOMEPORT_ALLOW_TERMINAL', label: 'Web terminal (exec into containers)', hint: 'needs EXEC=1 POST=1 — full shell access, enable with care' },
  { key: 'allowProxyAdmin', lock: 'allowProxyAdmin', env: 'HOMEPORT_ALLOW_PROXY_ADMIN', label: 'Manage the reverse proxy (domains)', hint: 'talks to your proxy, not Docker — needs provider credentials below' },
] as const

interface ChannelRow {
  name: string
  url: string
  preset: 'discord' | 'slack' | 'ntfy' | 'custom'
  template?: string
}

function addChannel() {
  form.alertChannels.push({ name: '', url: '', preset: 'discord', template: '' })
}

const proxyTesting = ref(false)
const proxyMsg = ref('')
const proxyOk = ref(false)
async function testProxy() {
  proxyTesting.value = true
  proxyMsg.value = ''
  try {
    // persist creds first so the server tests what's on screen
    await $fetch('/api/settings', {
      method: 'POST',
      body: {
        allowProxyAdmin: true,
        npmApiUrl: form.npmApiUrl,
        npmApiIdentity: form.npmApiIdentity,
        npmApiSecret: form.npmApiSecret,
        caddyAdminUrl: form.caddyAdminUrl,
      },
    })
    const r = await $fetch<{ ok: boolean; message: string; provider: string }>('/api/proxy/test', { method: 'POST' })
    proxyOk.value = r.ok
    proxyMsg.value = `${r.provider}: ${r.message}`
  } catch (e: any) {
    proxyOk.value = false
    proxyMsg.value = e?.statusMessage || e?.message || 'Test failed'
  } finally {
    proxyTesting.value = false
  }
}

const testMsg = ref('')
const testOk = ref(false)
const testing = ref(false)
async function sendTest() {
  testing.value = true
  testMsg.value = ''
  try {
    // persist current channels first so the server tests what's on screen
    await $fetch('/api/settings', { method: 'POST', body: { alertChannels: form.alertChannels } })
    const r = await $fetch<{ ok: boolean; channels: { name: string; ok: boolean; error?: string }[] }>('/api/alerts/test', {
      method: 'POST',
    })
    testOk.value = r.ok
    testMsg.value = r.channels.map((c) => `${c.name}: ${c.ok ? 'ok' : c.error || 'failed'}`).join(' · ')
  } catch (e: any) {
    testOk.value = false
    testMsg.value = e?.statusMessage || e?.message || 'Test failed'
  } finally {
    testing.value = false
  }
}

interface HostRow {
  id?: string
  name: string
  dockerHost: string
  dockerSshKey: string
  sshFingerprint: string
  domainProvider: string
  npmConfDir: string
  caddyfilePath: string
  nginxConfDir: string
  traefikFilePath: string
}

function addHost() {
  form.hosts.push({
    name: '',
    dockerHost: '',
    dockerSshKey: '',
    sshFingerprint: '',
    domainProvider: '',
    npmConfDir: '',
    caddyfilePath: '',
    nginxConfDir: '',
    traefikFilePath: '',
  })
}

onMounted(async () => {
  loadCaps()
  try {
    const r = await $fetch<any>('/api/settings')
    Object.assign(form, r.settings)
    form.hosts = (r.settings.hosts ?? []).map((h: Partial<HostRow>) => ({
      id: h.id,
      name: h.name ?? '',
      dockerHost: h.dockerHost ?? '',
      dockerSshKey: h.dockerSshKey ?? '',
      sshFingerprint: h.sshFingerprint ?? '',
      domainProvider: h.domainProvider ?? '',
      npmConfDir: h.npmConfDir ?? '',
      caddyfilePath: h.caddyfilePath ?? '',
      nginxConfDir: h.nginxConfDir ?? '',
      traefikFilePath: h.traefikFilePath ?? '',
    }))
    form.alertChannels = (r.settings.alertChannels ?? []).map((c: Partial<ChannelRow>) => ({
      name: c.name ?? '',
      url: c.url ?? '',
      preset: c.preset ?? 'discord',
      template: c.template ?? '',
    }))
    locked.value = r.locked
    writable.value = r.writable
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
  } finally {
    loaded.value = true
  }
})

async function save() {
  busy.value = true
  msg.value = ''
  try {
    await $fetch('/api/settings', { method: 'POST', body: { ...form } })
    msgOk.value = true
    msg.value = 'Saved.'
  } catch (e: any) {
    msgOk.value = false
    msg.value = e?.statusMessage || e?.message || 'Save failed'
  } finally {
    busy.value = false
  }
}

useHead({ title: 'Settings — homeport' })
</script>
