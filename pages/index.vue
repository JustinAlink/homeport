<template>
  <div class="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    <header class="mb-8 flex flex-wrap items-center gap-x-5 gap-y-4">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight text-slate-100">Fleet</h1>
        <p v-if="data" class="mt-1 text-[13px] text-slate-500">
          {{ data.stats.running }} running · {{ data.stats.total - data.stats.running }} stopped<template v-if="data.domainProvider"> · via {{ data.domainProvider }}</template>
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2.5">
        <SearchBar v-model="q" />
        <button
          class="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-white/5"
          :class="showGraph ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-300'"
          title="Toggle CPU/RAM graph"
          @click="toggleGraph"
        >📈</button>
        <button class="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5" title="Refresh" @click="refresh">↻</button>
      </div>
    </header>

    <div
      v-if="caps.loginDisabled && !caps.demo"
      class="mb-4 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-300"
    >
      ⚠️ Login is disabled — anyone who can reach homeport sees your whole fleet. Set
      <code>HOMEPORT_ADMIN_PASSWORD</code> and put it behind HTTPS.
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
      <div class="columns-1 gap-6 lg:columns-2 2xl:columns-3">
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
const showGraph = ref(false)

// Fleet graph range. 'live' = the in-memory rolling buffer; ranges load history.
const { range: graphRange, intervalSec: graphIntervalSec, past: fleetPast, load: loadFleetHistory } = useHistoryRange('host', '1h')
const { range: sysRange, past: systemPast, load: loadSystemHistory } = useHistoryRange('host-system', '1h')
watch(graphRange, (r) => (sysRange.value = r))
watch(showGraph, () => {
  loadFleetHistory()
  loadSystemHistory()
})

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
  if (localStorage.getItem('hp:graph') === '1') showGraph.value = true
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
