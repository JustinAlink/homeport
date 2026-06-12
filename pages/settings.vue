<template>
  <div class="mx-auto max-w-2xl px-4 py-6 sm:px-6">
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

    <form v-if="loaded" class="space-y-8" @submit.prevent="save">
      <!-- Docker connection -->
      <section class="space-y-3">
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
      </section>

      <!-- Hosts (multi-host) -->
      <section class="space-y-3">
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
      <section class="space-y-3">
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
      </section>

      <!-- Controls -->
      <section class="space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Controls</h2>
        <p v-if="locked.allowControl" class="text-xs text-slate-500">Set by <code>HOMEPORT_ALLOW_CONTROL</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.allowControl ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.allowControl" type="checkbox" />
          Enable start/stop buttons
          <span class="text-[11px] text-slate-500">(needs <code>POST=1</code> on the socket proxy)</span>
        </label>
      </section>

      <!-- Uptime -->
      <section class="space-y-3">
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
      <section class="space-y-3">
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
      <section class="space-y-3">
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
      <section class="space-y-3">
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
      <section class="space-y-3">
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

      <div class="flex items-center gap-3 border-t border-white/5 pt-5">
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
  allowControl: false,
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

interface ChannelRow {
  name: string
  url: string
  preset: 'discord' | 'slack' | 'ntfy' | 'custom'
  template?: string
}

function addChannel() {
  form.alertChannels.push({ name: '', url: '', preset: 'discord', template: '' })
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
