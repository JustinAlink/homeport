<template>
  <div class="mx-auto max-w-[1700px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-8 flex flex-wrap items-center gap-x-5 gap-y-4">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight text-slate-100">Fleet</h1>
        <p v-if="data" class="mt-1 text-[13px] text-slate-500">
          {{ data.stats.running }} running · {{ data.stats.total - data.stats.running }} stopped<template v-if="data.domainProvider"> · via {{ data.domainProvider }}</template>
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2.5">
        <span
          v-if="stats.stale.value"
          class="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-300"
          title="The stats poll keeps failing — the numbers below may be out of date."
        ><span class="h-1.5 w-1.5 rounded-full bg-amber-400" /> stats paused</span>
        <SearchBar v-model="q" />
        <button
          class="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-white/5"
          :class="showGraph ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-300'"
          title="Toggle CPU/RAM graph"
          @click="toggleGraph"
        ><Icon name="chart" class="h-4 w-4" /></button>
        <button class="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5" title="Refresh" @click="refresh"><Icon name="refresh" class="h-4 w-4" /></button>
      </div>
    </header>

    <div
      v-if="caps.loginDisabled && !caps.demo"
      class="mb-4 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-300"
    >
      Login is disabled — anyone who can reach homeport sees your whole fleet. Set
      <code>HOMEPORT_ADMIN_PASSWORD</code> and put it behind HTTPS.
    </div>

    <div
      v-if="showGettingStarted"
      class="mb-6 overflow-hidden rounded-xl border border-accent/20 bg-accent/[0.04] p-4"
    >
      <div class="flex items-start gap-3.5">
        <div class="mt-0.5 hidden rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent-light sm:block">
          <Icon name="globe" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-slate-100">Put your services on real domains</h2>
          <p class="mt-1 text-[13px] leading-relaxed text-slate-400">
            homeport maps each container to its URL by reading your reverse proxy — and it can install one for
            you. No proxy yet? <strong class="font-medium text-slate-300">Nginx Proxy Manager</strong> is the
            friendly default, with free HTTPS built in.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <NuxtLink
              to="/catalog/nginx-proxy-manager"
              class="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[13px] font-medium text-accent-light transition-colors hover:bg-accent/20"
            >Install a reverse proxy</NuxtLink>
            <button
              :disabled="connecting"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-60"
              @click="connectProxy"
            >{{ connecting ? 'Connecting…' : 'Already installed NPM? Connect it' }}</button>
            <NuxtLink
              to="/catalog"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-slate-300 transition-colors hover:bg-white/5"
            >Browse apps</NuxtLink>
          </div>
          <div
            v-if="connectMsg"
            class="mt-3 rounded-md border p-2.5 text-[12px] leading-relaxed"
            :class="connectOk ? 'border-ok/25 bg-ok/5 text-emerald-300' : 'border-amber-500/25 bg-amber-500/5 text-amber-300'"
          >
            {{ connectMsg }}
            <div v-if="connectSecret" class="mt-1.5 select-all rounded bg-black/30 px-2 py-1 font-mono text-[12px] text-slate-100">
              admin@example.com&nbsp;·&nbsp;{{ connectSecret }}
            </div>
          </div>
        </div>
        <button
          class="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
          title="Dismiss"
          @click="dismissGettingStarted"
        ><Icon name="x" class="h-4 w-4" /></button>
      </div>
    </div>

    <ResourceBar v-if="data && fleet" :fleet="fleet" :running="data.stats.running" :total="data.stats.total" class="mb-6" />

    <div v-if="showGraph" class="mb-7">
      <div class="mb-2 flex items-center gap-1 text-[11px]">
        <button
          v-for="r in (['live', '1h', '6h', '24h'] as const)"
          :key="r"
          class="rounded-md border px-2 py-0.5"
          :class="graphRange === r ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
          @click="graphRange = r"
        >{{ r }}</button>
      </div>
      <LineGraph :series="fleetSeries" :shared-max="100" :interval-sec="graphIntervalSec" />
    </div>

    <div v-if="multiHost" class="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
      <button
        class="rounded-md border px-2.5 py-1"
        :class="hostFilter === '' ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
        @click="hostFilter = ''"
      >All hosts</button>
      <button
        v-for="h in hosts"
        :key="h.id"
        class="flex items-center gap-1.5 rounded-md border px-2.5 py-1"
        :class="hostFilter === h.name ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
        :title="h.online ? '' : h.error || 'unreachable'"
        @click="hostFilter = h.name"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="h.online ? 'bg-ok' : 'bg-red-400'" />
        {{ h.name }}
      </button>
    </div>

    <div v-if="loading && !data" class="py-20 text-center text-slate-500">Loading…</div>
    <div v-else-if="error" class="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
      {{ error }}
    </div>

    <div v-else>
      <p v-if="!groups.length" class="py-20 text-center text-slate-500">No services match “{{ q }}”.</p>
      <div class="columns-1 gap-6 xl:columns-2">
        <StackGroup v-for="g in groups" :key="g.name" :name="g.name" :services="g.services" />

        <section v-if="unmatched.length" class="mb-4 break-inside-avoid">
          <div class="mb-2 flex items-center gap-3">
            <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500">Unmatched domains</h2>
            <span class="text-xs text-slate-600">{{ unmatched.length }}</span>
            <div class="h-px flex-1 bg-white/5" />
          </div>
          <div class="flex flex-col gap-1.5">
            <div v-for="u in unmatched" :key="u.upstream" class="rounded-md border border-white/5 bg-ink-900 px-2.5 py-1.5 text-[11px]">
              <span class="text-slate-300">{{ u.domains.join(', ') }}</span>
              <span class="text-slate-600"> → {{ u.upstream }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const { data, error, loading, refresh, start, stop } = useServices()
const stats = useStats()
const fleet = stats.host
const fleetHistory = stats.hostHistory
const systemHistory = stats.systemHistory
const showGraph = ref(true) // on by default — '0' in storage hides it

// Fleet graph range. 'live' = the in-memory rolling buffer; ranges load history.
const { range: graphRange, intervalSec: graphIntervalSec, past: fleetPast, load: loadFleetHistory } = useHistoryRange('host', '1h')
const { range: sysRange, past: systemPast, load: loadSystemHistory } = useHistoryRange('host-system', '1h')
watch(graphRange, (r) => (sysRange.value = r))
function loadGraphHistory() {
  loadFleetHistory()
  loadSystemHistory()
}
watch(showGraph, loadGraphHistory)
onMounted(loadGraphHistory)

const fleetSeries = computed(() => {
  const src = graphRange.value === 'live' ? fleetHistory.value : fleetPast.value ?? { cpu: [], mem: [] }
  const sys = graphRange.value === 'live' ? systemHistory.value : systemPast.value ?? { cpu: [], mem: [] }
  const out = [
    { label: 'Containers CPU', color: '#10b981', data: src.cpu, unit: '%' },
    { label: 'Containers RAM', color: '#38bdf8', data: src.mem, unit: '%' },
  ]
  // whole-machine series (procfs) — shows what the host uses beyond containers
  if (sys.cpu.length) out.push({ label: 'System CPU', color: '#a78bfa', data: sys.cpu, unit: '%' })
  if (sys.mem.length) out.push({ label: 'System RAM', color: '#f59e0b', data: sys.mem, unit: '%' })
  return out
})
const pings = usePings()
const { caps } = useCapabilities()
const q = ref('')
const hostFilter = ref('')

// Onboarding nudge: no reverse proxy detected yet → offer to install one.
// Dismissible; hidden in demo and once a provider is mapping domains.
const gsDismissed = ref(false)
const showGettingStarted = computed(
  () => !!data.value && !data.value.domainProvider && !caps.value.demo && !gsDismissed.value,
)
function dismissGettingStarted() {
  gsDismissed.value = true
  if (import.meta.client) localStorage.setItem('hp:gs', '0')
}

// One-click connect: auto-configure a homeport-installed Nginx Proxy Manager
// (rotate its default password) and turn proxy management on.
const connecting = ref(false)
const connectMsg = ref('')
const connectSecret = ref('')
const connectOk = ref(false)
async function connectProxy() {
  connecting.value = true
  connectMsg.value = ''
  connectSecret.value = ''
  try {
    const r = await $fetch<{ ok: boolean; secret?: string; notReady?: boolean; alreadyConfigured?: boolean; error?: string }>(
      '/api/proxy/bootstrap',
      { method: 'POST', body: {} },
    )
    if (r.ok) {
      connectOk.value = true
      connectSecret.value = r.secret || ''
      connectMsg.value = r.secret
        ? 'Connected — proxy management is on. Save this NPM login (you can sign into NPM directly with it):'
        : 'Connected — proxy management is on.'
      setTimeout(refresh, 1500) // provider now set → the card falls away
    } else if (r.notReady) {
      connectMsg.value = "Nginx Proxy Manager isn't reachable yet — give it a few seconds after installing, then try again."
    } else if (r.alreadyConfigured) {
      connectMsg.value = 'NPM is already set up. Add its email + password in Settings → Proxy management to connect.'
    } else {
      connectMsg.value = r.error || 'Could not connect to Nginx Proxy Manager.'
    }
  } catch (e: any) {
    connectMsg.value = errMsg(e, 'Could not connect to Nginx Proxy Manager')
  } finally {
    connecting.value = false
  }
}

const hosts = computed(() => data.value?.hosts ?? [])
const multiHost = computed(() => hosts.value.length > 1)

function toggleGraph() {
  showGraph.value = !showGraph.value
  localStorage.setItem('hp:graph', showGraph.value ? '1' : '0')
}

onMounted(() => {
  start()
  stats.start()
  pings.start()
  useCapabilities().load()
  useUpdates().refresh()
  if (localStorage.getItem('hp:graph') === '0') showGraph.value = false
  if (localStorage.getItem('hp:gs') === '0') gsDismissed.value = true
})
onBeforeUnmount(() => {
  stop()
  stats.stop()
  pings.stop()
})

const visible = computed<Service[]>(() =>
  (data.value?.services || []).filter((s) => !s.hidden && (!hostFilter.value || s.host === hostFilter.value)),
)

const filtered = computed<Service[]>(() => {
  const term = q.value.trim().toLowerCase()
  if (!term) return visible.value
  return visible.value.filter((s) =>
    [s.displayName, s.name, s.image, s.group, s.host, ...s.domains.map((d) => d.domain)]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
})

// In the multi-host "All" view, prefix the group with the host so stacks don't merge.
const groupKey = (s: Service) => (multiHost.value && !hostFilter.value && s.host ? `${s.host} · ${s.group}` : s.group)

const groups = computed(() => {
  const map = new Map<string, Service[]>()
  for (const s of filtered.value) {
    const k = groupKey(s)
    const arr = map.get(k) || []
    arr.push(s)
    map.set(k, arr)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, services]) => ({ name, services }))
})

const unmatched = computed(() => {
  const term = q.value.trim().toLowerCase()
  const list = data.value?.unmatched || []
  if (!term) return list
  return list.filter((u) => (u.domains.join(' ') + u.upstream).toLowerCase().includes(term))
})

useHead({ title: 'homeport' })
</script>
