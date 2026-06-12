<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <!-- header -->
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <template v-if="service">
        <ServiceIcon :name="service.displayName" :icon="service.icon" :size="40" :remote="remoteIcons" />
        <div class="min-w-0">
          <h1 class="truncate text-xl font-semibold text-slate-100">{{ service.displayName }}</h1>
          <p class="truncate font-mono text-xs text-slate-500">{{ service.image }}</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <span v-if="updateEntry?.status === 'update'" class="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-300">
            update available
          </span>
          <button
            v-if="caps.control && isUp"
            :disabled="busy"
            class="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            @click="control('restart')"
          >↻ Restart</button>
          <button
            v-if="caps.control"
            :disabled="busy"
            class="rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50"
            :class="isUp ? 'border-red-500/20 text-red-300 hover:bg-red-500/10' : 'border-accent/25 text-accent-light hover:bg-accent/10'"
            @click="control(isUp ? 'stop' : 'start')"
          >{{ busy ? '…' : isUp ? 'Stop' : 'Start' }}</button>
          <StatusPill :state="service.state" :health="service.health" />
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

        <div v-if="service.domains.length || service.ports.length" class="flex flex-wrap items-center gap-1.5">
          <a
            v-for="d in service.domains"
            :key="d.domain"
            :href="d.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-xs text-accent-light hover:bg-accent/20"
          >
            <span v-if="d.ssl" class="text-[10px]">🔒</span>{{ d.domain }}
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

      <!-- DOMAINS -->
      <section v-else-if="tab === 'domains'" class="max-w-xl space-y-4">
        <p class="text-sm text-slate-400">Add a reverse-proxy route pointing a domain at this container.</p>
        <DomainForm
          :initial="{ upstreamHost: service.name, upstreamPort: service.ports[0]?.hostPort ?? 80, ssl: true }"
          submit-label="Add domain"
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
            <button
              v-if="updateEntry?.status === 'update' && caps.updates"
              :disabled="applying"
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-50"
              @click="apply"
            >{{ applying ? 'Updating…' : 'Update now' }}</button>
            <span v-if="updateEntry?.status === 'update' && !caps.updates" class="text-[11px] text-slate-500">
              applying updates is disabled (Settings → Capabilities)
            </span>
          </div>
        </div>

        <div v-if="applySteps.length" class="rounded-lg border border-white/5 bg-ink-900 p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Update steps</p>
          <div v-for="(s, i) in applySteps" :key="i" class="flex items-center gap-2 py-0.5 text-xs">
            <span>{{ s.ok ? '✅' : '❌' }}</span>
            <span class="text-slate-300">{{ s.step }}</span>
            <span v-if="s.detail" class="truncate text-slate-500">{{ s.detail }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const id = decodeURIComponent(String(route.params.id))

const { data, loading, refresh, start, stop } = useServices()
const stats = useStats()
const { caps, load: loadCaps } = useCapabilities()
const updates = useUpdates()

const service = computed(() => data.value?.services.find((s) => s.id === id))
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const hostName = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const isUp = computed(() => service.value?.state === 'running' || service.value?.state === 'restarting')

type Tab = 'overview' | 'logs' | 'terminal' | 'domains' | 'update'
const tab = ref<Tab>('overview')
const tabs = computed(() => [
  { key: 'overview' as Tab, label: 'Overview' },
  ...(caps.value.logs ? [{ key: 'logs' as Tab, label: 'Logs' }] : []),
  ...(caps.value.terminal ? [{ key: 'terminal' as Tab, label: 'Terminal' }] : []),
  ...(caps.value.proxyAdmin ? [{ key: 'domains' as Tab, label: 'Domains' }] : []),
  ...(updates.enabled.value || caps.value.updates ? [{ key: 'update' as Tab, label: 'Update' }] : []),
])

function onDomainSaved() {
  refresh()
  tab.value = 'overview'
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
type Range = 'live' | '1h' | '6h' | '24h'
const range = ref<Range>('live')
const past = ref<{ cpu: number[]; mem: number[] } | null>(null)
const fill = (a: (number | null)[]) => {
  let last = 0
  return a.map((v) => (v == null ? last : (last = v)))
}
watch(range, async () => {
  if (range.value === 'live') return
  try {
    const r = await $fetch<{ cpu: (number | null)[]; mem: (number | null)[] }>('/api/history', {
      params: { id, range: range.value },
    })
    past.value = { cpu: fill(r.cpu), mem: fill(r.mem) }
  } catch {
    past.value = null
  }
})
const series = computed(() => {
  const live = stats.history.value[id] ?? { cpu: [], mem: [] }
  const src = range.value === 'live' ? live : past.value ?? { cpu: [], mem: [] }
  return [
    { label: 'CPU', color: '#10b981', data: src.cpu, unit: '%' },
    { label: 'MEM', color: '#38bdf8', data: src.mem, unit: 'MiB' },
  ]
})

// --- controls ---
const busy = ref(false)
async function control(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !window.confirm(`Stop “${service.value?.displayName}”?`)) return
  busy.value = true
  try {
    await $fetch('/api/control', { method: 'POST', body: { id, action } })
    await refresh()
  } catch (e: any) {
    window.alert(e?.statusMessage || e?.message || 'Action failed')
  } finally {
    busy.value = false
  }
}

// --- update tab ---
const updatesEnabled = computed(() => updates.enabled.value)
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
    window.alert(e?.statusMessage || 'Check failed')
  } finally {
    checking.value = false
  }
}

const applying = ref(false)
const applySteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])
async function apply() {
  if (!window.confirm(`Update “${service.value?.displayName}” to the latest image? The container will be recreated.`)) return
  applying.value = true
  applySteps.value = []
  try {
    const r = await $fetch<{ steps: typeof applySteps.value }>('/api/updates/apply', {
      method: 'POST',
      body: { id, image: service.value?.image },
    })
    applySteps.value = r.steps
    await Promise.all([refresh(), updates.refresh()])
  } catch (e: any) {
    applySteps.value = e?.data?.data?.steps || []
    window.alert(e?.statusMessage || 'Update failed')
  } finally {
    applying.value = false
  }
}

onMounted(() => {
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
