<template>
  <div class="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
    <!-- header -->
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <template v-if="service">
        <ServiceIcon :name="service.displayName" :icon="service.icon" :size="40" :remote="remoteIcons" />
        <div class="min-w-0">
          <h1 class="truncate text-xl font-semibold text-slate-100">{{ service.displayName }}</h1>
          <p class="truncate font-mono text-xs text-slate-500">{{ service.image }}</p>
        </div>
        <div class="ml-auto flex items-center gap-3">
          <span v-if="updateEntry?.status === 'update'" class="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-300">
            update available
          </span>
          <StatusPill :state="service.state" :health="service.health" />
          <div v-if="caps.control" class="flex items-center overflow-hidden rounded-lg border border-white/10 bg-ink-900 shadow-sm">
            <template v-if="isUp">
              <button
                :disabled="!!busy"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
                @click="control('restart')"
              >
                <Icon name="refresh" class="h-3.5 w-3.5" :class="busy === 'restart' ? 'animate-spin' : ''" />
                {{ busy === 'restart' ? 'Restarting…' : 'Restart' }}
              </button>
              <div class="h-5 w-px bg-white/10" />
              <button
                :disabled="!!busy"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-40"
                @click="control('stop')"
              >
                <Icon name="square" class="h-3.5 w-3.5" />
                {{ busy === 'stop' ? 'Stopping…' : 'Stop' }}
              </button>
            </template>
            <button
              v-else
              :disabled="!!busy"
              class="inline-flex items-center gap-1.5 bg-accent px-3.5 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-light disabled:opacity-40"
              @click="control('start')"
            >
              <Icon name="play" class="h-3.5 w-3.5" />
              {{ busy === 'start' ? 'Starting…' : 'Start' }}
            </button>
          </div>
        </div>
      </template>
    </header>

    <div v-if="!service && loading" class="py-20 text-center text-slate-500">Loading…</div>
    <div v-else-if="!service" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
      Service not found — it may have been removed.
      <NuxtLink to="/" class="text-accent-light hover:underline">Back to the dashboard</NuxtLink>
    </div>

    <template v-else>
      <!-- tabs -->
      <nav class="mb-4 flex items-center gap-1 border-b border-white/5 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="-mb-px border-b-2 px-3 py-2"
          :class="tab === t.key ? 'border-accent text-accent-light' : 'border-transparent text-slate-400 hover:text-slate-200'"
          @click="tab = t.key"
        >{{ t.label }}</button>
      </nav>

      <!-- OVERVIEW -->
      <section v-if="tab === 'overview'" class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="f in facts" :key="f.label" class="rounded-lg border border-white/5 bg-ink-900 p-3">
            <p class="text-[11px] uppercase tracking-wider text-slate-500">{{ f.label }}</p>
            <p class="mt-0.5 truncate text-sm text-slate-200" :title="f.value">{{ f.value }}</p>
          </div>
        </div>

        <!-- restart policy: whether this container comes back on reboot -->
        <div
          v-if="service.kind === 'container' && restart.policy !== null"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-xs"
        >
          <span class="uppercase tracking-wider text-slate-500">Start on boot</span>
          <select
            v-model="restart.selected"
            :disabled="!caps.control"
            class="rounded-md border border-white/10 bg-ink-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-accent/50 disabled:opacity-50"
          >
            <option value="unless-stopped">unless-stopped — start on boot (unless you stopped it)</option>
            <option value="always">always — start on boot, restart on crash</option>
            <option value="on-failure">on-failure — only restart after crashes</option>
            <option value="no">no — stays down after a reboot</option>
          </select>
          <button
            v-if="restart.selected !== restart.policy"
            :disabled="restart.saving"
            class="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-40"
            @click="saveRestartPolicy"
          >{{ restart.saving ? 'Applying…' : 'Apply' }}</button>
          <span v-if="restart.msg" class="text-[11px]" :class="restart.ok ? 'text-accent-light' : 'text-red-400'">{{ restart.msg }}</span>
          <span v-if="!caps.control" class="text-[11px] text-slate-600">needs the start/stop capability</span>
          <span v-else-if="restart.composeManaged" class="basis-full text-[11px] text-slate-600">
            <Icon name="alert" class="mr-1 inline h-3 w-3 align-[-1px]" /> compose-managed: this applies immediately, but the compose file's <code>restart:</code> wins if the stack is recreated — update it there too for a permanent change.
          </span>
        </div>

        <div v-if="service.domains.length || service.ports.length" class="flex flex-wrap items-center gap-1.5">
          <a
            v-for="d in service.domains"
            :key="d.domain"
            :href="d.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-xs text-accent-light hover:bg-accent/20"
          >
            <Icon v-if="d.ssl" name="lock" class="h-3 w-3 opacity-70" />{{ d.domain }}
          </a>
          <a
            v-for="p in service.ports"
            :key="p.hostPort + p.type"
            :href="`http://${hostName}:${p.hostPort}`"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/10"
          >:{{ p.hostPort }}</a>
        </div>

        <div v-if="service.state === 'running'">
          <div class="mb-2 flex items-center gap-1 text-[11px]">
            <button
              v-for="r in (['live', '1h', '6h', '24h'] as const)"
              :key="r"
              class="rounded-md border px-2 py-0.5"
              :class="range === r ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
              @click="range = r"
            >{{ r }}</button>
          </div>
          <LineGraph v-if="series[0].data.length > 1" :series="series" :height="160" :interval-sec="range === 'live' ? 7 : 60" />
          <p v-else class="text-xs text-slate-600">collecting data…</p>
        </div>

        <!-- danger zone: recreate + delete -->
        <div v-if="caps.control && service.kind === 'container'" class="rounded-lg border border-red-500/15 bg-ink-900 p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-red-300/80">Danger zone</p>
          <p v-if="composeProject && stackManaged" class="mb-3 text-[11px] leading-relaxed text-slate-500">
            Part of the managed stack “{{ composeProject }}” — a deleted or recreated container comes back on the
            stack's next <code>up</code>. For a permanent change, use the
            <NuxtLink :to="`/stacks/${composeProject}`" class="text-accent-light hover:underline">stack page</NuxtLink>.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <button
              :disabled="applying || deleting"
              class="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              @click="recreate"
            ><Icon name="refresh" class="h-3.5 w-3.5" :class="applying ? 'animate-spin' : ''" /> {{ applying ? 'Recreating…' : 'Recreate' }}</button>
            <span class="text-[11px] text-slate-600">stop and recreate with the same image and settings — for containers in a wedged state</span>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
            <button
              :disabled="applying || deleting"
              class="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
              @click="deleteContainer"
            ><Icon name="x" class="h-3.5 w-3.5" /> {{ deleting ? 'Deleting…' : 'Delete container' }}</button>
            <label class="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input v-model="deleteVolumes" type="checkbox" class="h-3 w-3" />
              also delete its anonymous volumes
            </label>
          </div>
          <div v-if="dangerSteps.length" class="mt-3 border-t border-white/5 pt-3">
            <div v-for="(s, i) in dangerSteps" :key="i" class="flex items-center gap-2 py-0.5 text-xs">
              <Icon :name="s.ok ? 'check' : 'x'" class="h-3.5 w-3.5 shrink-0" :class="s.ok ? 'text-ok' : 'text-red-400'" />
              <span class="text-slate-300">{{ s.step }}</span>
              <span v-if="s.detail" class="truncate text-slate-500">{{ s.detail }}</span>
            </div>
            <p v-if="redirecting" class="mt-1 animate-pulse text-xs text-accent-light">container recreated — opening its new page…</p>
            <NuxtLink v-else-if="newPage" :to="newPage" class="mt-1 inline-block text-xs text-accent-light hover:underline">Open the recreated container →</NuxtLink>
          </div>
        </div>
      </section>

      <!-- LOGS -->
      <section v-else-if="tab === 'logs'" class="h-[65vh]">
        <LogsView v-if="caps.logs" :id="service.id" class="h-full" />
        <p v-else class="text-sm text-slate-500">Logs are disabled (<code>HOMEPORT_LOGS=false</code>).</p>
      </section>

      <!-- TERMINAL -->
      <section v-else-if="tab === 'terminal'" class="h-[65vh]">
        <TerminalView v-if="isUp" :id="service.id" :name="service.displayName" class="h-full" />
        <p v-else class="text-sm text-slate-500">The container isn't running — start it to open a shell.</p>
      </section>

      <!-- ENVIRONMENT -->
      <section v-else-if="tab === 'env'" class="max-w-2xl space-y-4">
        <div v-if="composeProject && stackManaged" class="rounded-lg border border-white/5 bg-ink-900 p-4 text-sm text-slate-400">
          This container belongs to the managed stack “{{ composeProject }}” — set its environment in the compose file,
          so the change survives redeploys.
          <NuxtLink :to="`/stacks/${composeProject}`" class="text-accent-light hover:underline">Open the stack →</NuxtLink>
        </div>
        <template v-else>
          <p v-if="composeProject && stackChecked" class="rounded-lg border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-300/90">
            Part of the “{{ composeProject }}” compose project (not managed by homeport): changes apply now, but a future
            <code>docker compose up</code> from its original compose file recreates the container with the old environment —
            mirror the change there too.
          </p>
          <div v-if="!envLoaded" class="py-8 text-center text-sm text-slate-500">Loading…</div>
          <p v-else-if="envError" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ envError }}</p>
          <template v-else>
            <div class="space-y-2">
              <div v-for="(row, i) in envRows" :key="i" class="flex items-center gap-2">
                <input
                  v-model="row.key"
                  placeholder="NAME"
                  spellcheck="false"
                  class="w-2/5 rounded-md border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-accent/50"
                />
                <input
                  v-model="row.value"
                  :type="row.secret ? 'password' : 'text'"
                  :placeholder="row.keep ? 'unchanged — type to replace' : ''"
                  spellcheck="false"
                  class="flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-accent/50"
                  @input="row.keep = false"
                />
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                  @click="envRows.splice(i, 1)"
                >Remove</button>
              </div>
              <button
                type="button"
                class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                @click="envRows.push({ key: '', value: '', keep: false, secret: false })"
              >+ Add variable</button>
            </div>
            <div class="flex items-center gap-3">
              <button
                :disabled="applying"
                class="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-light disabled:opacity-40"
                @click="applyEnv"
              >{{ applying ? 'Recreating…' : 'Apply & recreate' }}</button>
              <button
                type="button"
                :disabled="applying"
                class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-40"
                @click="reloadEnv"
              >Discard changes</button>
              <span class="text-[11px] text-slate-600">applying stops the container and recreates it with the new environment</span>
            </div>
            <div v-if="envSteps.length" class="rounded-lg border border-white/5 bg-ink-900 p-4">
              <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recreate steps</p>
              <div v-for="(s, i) in envSteps" :key="i" class="flex items-center gap-2 py-0.5 text-xs">
                <Icon :name="s.ok ? 'check' : 'x'" class="h-3.5 w-3.5 shrink-0" :class="s.ok ? 'text-ok' : 'text-red-400'" />
                <span class="text-slate-300">{{ s.step }}</span>
                <span v-if="s.detail" class="truncate text-slate-500">{{ s.detail }}</span>
              </div>
              <p v-if="redirecting" class="mt-2 animate-pulse text-xs text-accent-light">container recreated — opening its new page…</p>
              <NuxtLink v-else-if="newPage" :to="newPage" class="mt-2 inline-block text-xs text-accent-light hover:underline">Open the updated container →</NuxtLink>
            </div>
          </template>
        </template>
      </section>

      <!-- DOMAINS -->
      <section v-else-if="tab === 'domains'" class="max-w-xl space-y-4">
        <p class="text-sm text-slate-400">
          {{ matchedRoute ? 'This container already has a reverse-proxy route — edit it below.' : 'Add a reverse-proxy route pointing a domain at this container.' }}
        </p>
        <DomainForm
          :key="domainFormKey"
          :initial="domainInitial"
          :submit-label="matchedRoute ? 'Update domain' : 'Add domain'"
          @saved="onDomainSaved"
        />
        <NuxtLink to="/domains" class="inline-block text-xs text-accent-light hover:underline">Manage all domains →</NuxtLink>
      </section>

      <!-- UPDATE -->
      <section v-else-if="tab === 'update'" class="max-w-xl space-y-4">
        <div class="rounded-lg border border-white/5 bg-ink-900 p-4">
          <div class="flex items-center gap-2">
            <span class="text-sm text-slate-200">Image status:</span>
            <span class="rounded-full px-2 py-0.5 text-xs" :class="updateBadgeCls">{{ updateLabel }}</span>
          </div>
          <dl v-if="updateEntry" class="mt-3 space-y-1 font-mono text-[11px] text-slate-500">
            <div v-if="updateEntry.localDigest" class="truncate"><dt class="inline text-slate-600">local: </dt><dd class="inline">{{ updateEntry.localDigest }}</dd></div>
            <div v-if="updateEntry.remoteDigest" class="truncate"><dt class="inline text-slate-600">remote: </dt><dd class="inline">{{ updateEntry.remoteDigest }}</dd></div>
            <div><dt class="inline text-slate-600">checked: </dt><dd class="inline">{{ new Date(updateEntry.checkedAt).toLocaleString() }}</dd></div>
            <div v-if="updateEntry.error" class="text-amber-300/90">{{ updateEntry.error }}</div>
          </dl>
          <p v-else class="mt-2 text-xs text-slate-500">
            {{ updatesEnabled ? 'Not checked yet.' : 'Update checks are disabled — enable them in Settings → Capabilities.' }}
          </p>
          <div class="mt-4 flex items-center gap-2">
            <button
              v-if="updatesEnabled"
              :disabled="checking"
              class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
              @click="checkNow"
            >{{ checking ? 'Checking…' : 'Check now' }}</button>
            <template v-if="updateEntry?.status === 'update'">
              <NuxtLink
                v-if="stackManaged"
                :to="`/stacks/${composeProject}`"
                class="rounded-md border border-sky-400/30 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-400/10"
              >Update via stack “{{ composeProject }}” →</NuxtLink>
              <button
                v-else-if="caps.updates && (!composeProject || stackChecked)"
                :disabled="applying"
                class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-50"
                @click="apply"
              >{{ applying ? 'Updating…' : 'Update now' }}</button>
              <span v-else-if="!caps.updates" class="text-[11px] text-slate-500">applying updates is disabled (Settings → Capabilities)</span>
            </template>
          </div>
          <p v-if="updateEntry?.status === 'update' && composeProject && stackChecked && !stackManaged" class="mt-2 text-[11px] text-slate-500">
            part of the “{{ composeProject }}” compose project (not managed by homeport) — updating pulls the image and
            recreates this container in place with its current settings.
            <NuxtLink
              v-if="projectSiblings > 1"
              :to="`/stacks/${composeProject}`"
              class="text-accent-light hover:underline"
            >Update the whole project at once →</NuxtLink>
          </p>
        </div>

        <div v-if="applySteps.length" class="rounded-lg border border-white/5 bg-ink-900 p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Update steps</p>
          <div v-for="(s, i) in applySteps" :key="i" class="flex items-center gap-2 py-0.5 text-xs">
            <Icon :name="s.ok ? 'check' : 'x'" class="h-3.5 w-3.5 shrink-0" :class="s.ok ? 'text-ok' : 'text-red-400'" />
            <span class="text-slate-300">{{ s.step }}</span>
            <span v-if="s.detail" class="truncate text-slate-500">{{ s.detail }}</span>
          </div>
          <p v-if="redirecting" class="mt-2 animate-pulse text-xs text-accent-light">
            container recreated — opening its new page…
          </p>
          <NuxtLink
            v-else-if="newPage"
            :to="newPage"
            class="mt-2 inline-block text-xs text-accent-light hover:underline"
          >Open the updated container →</NuxtLink>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

// remount when the id param changes (an applied update navigates to the new container id)
definePageMeta({ key: (route) => route.fullPath })

const route = useRoute()
const id = decodeURIComponent(String(route.params.id))

const { data, loading, refresh, start, stop } = useServices()
const stats = useStats()
const { caps, loaded: capsLoaded, load: loadCaps } = useCapabilities()
const updates = useUpdates()

const applying = ref(false)
const newPage = ref('') // route of the recreated container once an update lands
const redirecting = ref(false)

// While an update recreates the container it briefly vanishes from the live
// list (old renamed away, new not up yet) — keep rendering the last-seen data
// instead of flashing "service not found".
const liveService = computed(() => data.value?.services.find((s) => s.id === id))
const lastSeen = ref<Service>()
watchEffect(() => {
  if (liveService.value) lastSeen.value = liveService.value
})
const service = computed(() => liveService.value ?? (applying.value || newPage.value ? lastSeen.value : undefined))
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const hostName = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const isUp = computed(() => service.value?.state === 'running' || service.value?.state === 'restarting')

type Tab = 'overview' | 'logs' | 'terminal' | 'env' | 'domains' | 'update'
const tab = ref<Tab>('overview')
const tabs = computed(() => [
  { key: 'overview' as Tab, label: 'Overview' },
  ...(caps.value.logs ? [{ key: 'logs' as Tab, label: 'Logs' }] : []),
  ...(caps.value.terminal ? [{ key: 'terminal' as Tab, label: 'Terminal' }] : []),
  ...(caps.value.updates ? [{ key: 'env' as Tab, label: 'Environment' }] : []),
  ...(caps.value.proxyAdmin ? [{ key: 'domains' as Tab, label: 'Domains' }] : []),
  ...(updates.enabled.value || caps.value.updates ? [{ key: 'update' as Tab, label: 'Update' }] : []),
])

// --- domains tab ---
// Pull the proxy's existing routes so the form can pre-fill and, when a route
// already points at this container, switch from "Add" (POST → would conflict)
// to "Update" (PUT) instead.
interface ProxyRoute { id: string; domains: string[]; upstreamHost: string; upstreamPort: number; ssl: boolean }
const proxyRoutes = ref<ProxyRoute[]>([])
const routesLoaded = ref(false)
async function loadRoutes() {
  try {
    const r = await $fetch<{ routes: ProxyRoute[] }>('/api/proxy/routes')
    proxyRoutes.value = r.routes ?? []
  } catch {
    // proxy admin unreachable — fall back to prefill-only (no route id → plain Add)
  } finally {
    routesLoaded.value = true
  }
}
watch(
  () => tab.value === 'domains' && caps.value.proxyAdmin,
  (on) => { if (on && !routesLoaded.value) loadRoutes() },
  { immediate: true },
)
const matchedRoute = computed(() =>
  service.value ? proxyRoutes.value.find((r) => r.upstreamHost === service.value!.name) : undefined,
)
const domainInitial = computed(() => {
  const s = service.value!
  const m = matchedRoute.value
  if (m) return { id: m.id, domains: m.domains, upstreamHost: m.upstreamHost, upstreamPort: m.upstreamPort, ssl: m.ssl }
  return { domains: s.domains.map((d) => d.domain), upstreamHost: s.name, upstreamPort: s.ports[0]?.hostPort ?? 80, ssl: s.domains[0]?.ssl ?? true }
})
// remount the form once routes resolve so it re-reads `initial`
const domainFormKey = computed(() => (matchedRoute.value?.id ?? (routesLoaded.value ? 'new' : 'loading')))

function onDomainSaved() {
  refresh()
  loadRoutes()
  tab.value = 'overview'
}

// --- restart policy (start on boot) ---
const restart = reactive({
  policy: null as string | null,
  selected: 'no',
  composeManaged: false,
  saving: false,
  msg: '',
  ok: false,
})

async function loadRestartPolicy() {
  try {
    const r = await $fetch<{ policy: string; composeManaged: boolean }>('/api/restart-policy', { query: { id } })
    restart.policy = r.policy
    restart.selected = r.policy
    restart.composeManaged = r.composeManaged
  } catch {
    restart.policy = null // endpoint unavailable (e.g. host down) — hide the row
  }
}

async function saveRestartPolicy() {
  restart.saving = true
  restart.msg = ''
  try {
    await $fetch('/api/restart-policy', { method: 'POST', body: { id, policy: restart.selected } })
    restart.policy = restart.selected
    restart.ok = true
    restart.msg = restart.selected === 'no' ? 'applied — this container will stay down after a reboot.' : 'applied.'
  } catch (e: any) {
    restart.ok = false
    restart.msg = errMsg(e, 'could not change the restart policy')
  } finally {
    restart.saving = false
  }
}

// --- overview facts ---
const facts = computed(() => {
  const s = service.value!
  const stat = stats.stats.value[s.id]
  return [
    { label: 'State', value: s.statusText || s.state },
    { label: 'Group', value: (s.host ? `${s.host} · ` : '') + s.group },
    { label: 'CPU', value: stat?.cpuPercent != null ? `${stat.cpuPercent}%` : '—' },
    { label: 'Memory', value: stat ? formatBytes(stat.memBytes) : '—' },
  ]
})

// --- overview graph (live buffer or persisted history) ---
const { range, past } = useHistoryRange(id)
const series = computed(() => {
  const live = stats.history.value[id] ?? { cpu: [], mem: [] }
  const src = range.value === 'live' ? live : past.value ?? { cpu: [], mem: [] }
  return [
    { label: 'CPU', color: '#10b981', data: src.cpu, unit: '%' },
    { label: 'MEM', color: '#38bdf8', data: src.mem, unit: 'MiB' },
  ]
})

// --- danger zone: recreate + delete ---
const deleting = ref(false)
const deleteVolumes = ref(false)
const dangerSteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])

async function recreate() {
  if (!window.confirm(`Recreate “${service.value?.displayName}” in place? It restarts with the same image and settings.`)) return
  applying.value = true
  dangerSteps.value = []
  try {
    const r = await $fetch<{ steps: typeof dangerSteps.value; newId?: string }>('/api/recreate', { method: 'POST', body: { id } })
    dangerSteps.value = r.steps
    await refresh()
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    }
  } catch (e: any) {
    dangerSteps.value = e?.data?.data?.steps || []
    window.alert(errMsg(e, 'Recreate failed'))
  } finally {
    applying.value = false
  }
}

async function deleteContainer() {
  const name = service.value?.displayName
  if (!window.confirm(`Delete “${name}” permanently?${deleteVolumes.value ? ' Its anonymous volumes are removed too.' : ''}\nThis cannot be undone.`)) return
  deleting.value = true
  try {
    await $fetch('/api/control', { method: 'POST', body: { id, action: 'remove', volumes: deleteVolumes.value } })
    await navigateTo('/', { replace: true })
  } catch (e: any) {
    window.alert(errMsg(e, 'Delete failed'))
  } finally {
    deleting.value = false
  }
}

// --- controls ---
const busy = ref<'' | 'start' | 'stop' | 'restart'>('')
async function control(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !window.confirm(`Stop “${service.value?.displayName}”?`)) return
  busy.value = action
  try {
    await $fetch('/api/control', { method: 'POST', body: { id, action } })
    await refresh()
  } catch (e: any) {
    window.alert(errMsg(e, 'Action failed'))
  } finally {
    busy.value = ''
  }
}

// --- update tab ---
const updatesEnabled = computed(() => updates.enabled.value)
// compose-managed containers update through their stack — but only when homeport
// actually manages that stack; foreign projects fall back to a direct recreate
const composeProject = computed(() => (service.value?.kind === 'container' ? service.value?.project : null))
const projectSiblings = computed(
  () => (data.value?.services ?? []).filter((s) => s.project && s.project === composeProject.value).length,
)
const stackChecked = ref(false)
const stackManaged = ref(false)
async function checkStackManaged() {
  if (!composeProject.value || !caps.value.stacks) {
    stackChecked.value = true
    return
  }
  try {
    const r = await $fetch<{ stacks: { name: string }[] }>('/api/stacks')
    stackManaged.value = (r.stacks ?? []).some((s) => s.name === composeProject.value)
  } catch {
    stackManaged.value = false // stacks unavailable — direct update is the only path
  }
  stackChecked.value = true
}
// resolved on load — the Overview danger zone, Update and Environment tabs all use it
watch(
  () => !!service.value && capsLoaded.value,
  (on) => { if (on && !stackChecked.value) checkStackManaged() },
  { immediate: true },
)
const updateEntry = computed(() => (service.value ? updates.entryFor(service.value) : undefined))
const updateLabel = computed(() => {
  switch (updateEntry.value?.status) {
    case 'update': return 'update available'
    case 'current': return 'up to date'
    case 'local': return 'locally built'
    case 'pinned': return 'digest-pinned'
    case 'error': return 'check failed'
    default: return 'unknown'
  }
})
const updateBadgeCls = computed(() =>
  updateEntry.value?.status === 'update'
    ? 'border border-sky-400/30 bg-sky-400/10 text-sky-300'
    : updateEntry.value?.status === 'error'
      ? 'border border-amber-400/30 bg-amber-400/10 text-amber-300'
      : 'border border-white/10 bg-white/5 text-slate-400',
)

const checking = ref(false)
async function checkNow() {
  checking.value = true
  try {
    await $fetch('/api/updates/check', { method: 'POST' })
    await updates.refresh()
  } catch (e: any) {
    window.alert(errMsg(e, 'Check failed'))
  } finally {
    checking.value = false
  }
}

const applySteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])
async function apply() {
  if (!window.confirm(`Update “${service.value?.displayName}” to the latest image? The container will be recreated.`)) return
  applying.value = true
  applySteps.value = []
  try {
    const r = await $fetch<{ steps: typeof applySteps.value; newId?: string }>('/api/updates/apply', {
      method: 'POST',
      body: { id, image: service.value?.image },
    })
    applySteps.value = r.steps
    await Promise.all([refresh(), updates.refresh()])
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        // clean update — follow the container to its new id
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    }
  } catch (e: any) {
    applySteps.value = e?.data?.data?.steps || []
    window.alert(errMsg(e, 'Update failed'))
  } finally {
    applying.value = false
  }
}

// --- environment tab ---
interface EnvRow { key: string; value: string; keep: boolean; secret: boolean }
const envRows = ref<EnvRow[]>([])
const envLoaded = ref(false)
const envError = ref('')
const envSteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])

async function loadEnv() {
  envError.value = ''
  try {
    const r = await $fetch<{ env: { key: string; value: string | null; secret: boolean }[] }>('/api/env', { query: { id } })
    envRows.value = r.env.map((e) => ({ key: e.key, value: e.value ?? '', keep: e.value === null, secret: e.secret }))
  } catch (e: any) {
    envError.value = errMsg(e, 'could not read the environment')
  }
  envLoaded.value = true
}
function reloadEnv() {
  envLoaded.value = false
  envSteps.value = []
  loadEnv()
}
watch(
  () => tab.value === 'env' && !!service.value && !stackManaged.value,
  (on) => { if (on && !envLoaded.value) loadEnv() },
  { immediate: true },
)

async function applyEnv() {
  if (!window.confirm(`Recreate “${service.value?.displayName}” with the edited environment?`)) return
  applying.value = true
  envSteps.value = []
  try {
    const r = await $fetch<{ steps: typeof envSteps.value; newId?: string }>('/api/env', {
      method: 'POST',
      body: { id, env: envRows.value.map((row) => ({ key: row.key.trim(), value: row.keep ? null : row.value })) },
    })
    envSteps.value = r.steps
    await refresh()
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    } else {
      reloadEnv() // demo / same id — re-read what's now in place
      envSteps.value = r.steps
    }
  } catch (e: any) {
    envSteps.value = e?.data?.data?.steps || []
    window.alert(errMsg(e, 'Environment change failed'))
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  loadRestartPolicy()
  start()
  stats.start()
  loadCaps()
  updates.refresh()
})
onBeforeUnmount(() => {
  stop()
  stats.stop()
})

useHead({ title: computed(() => `${service.value?.displayName ?? 'service'} — homeport`) })
</script>
