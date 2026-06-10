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
            <p class="text-[11px] text-slate-500">The remote host key isn't verified yet — use on trusted hosts.</p>
          </div>
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
            <option value="traefik">Traefik (labels)</option>
            <option value="caddy">Caddy</option>
          </select>
          <input
            v-if="form.domainProvider === 'npm' || (form.domainProvider === '' && form.npmConfDir)"
            v-model="form.npmConfDir"
            :class="fieldCls"
            placeholder="NPM proxy_host dir (in-container path)"
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
  domainProvider: '',
  npmConfDir: '',
  caddyfilePath: '',
  allowControl: false,
  pingEnabled: true,
  systemdEnabled: false,
})

onMounted(async () => {
  try {
    const r = await $fetch<any>('/api/settings')
    Object.assign(form, r.settings)
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
