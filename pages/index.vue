<template>
  <div class="page">
    <PageHeader title="Dashboard">
      <template #subtitle>
        <template v-if="data">
          {{ data.stats.running }} of {{ data.stats.total }} containers running across your fleet<template v-if="missingTotal"> · {{ missingTotal }} stack service{{ missingTotal > 1 ? 's' : '' }} not started</template><template v-if="data.domainProvider"> · domains via {{ data.domainProvider }}</template>
        </template>
        <template v-else>Your fleet at a glance</template>
      </template>
      <template #actions>
        <span
          v-if="stats.stale.value"
          class="badge badge-warn"
          title="The stats poll keeps failing, so the numbers below may be out of date."
        ><span class="dot h-1.5 w-1.5 bg-amber-400" /> stats paused</span>
        <button class="btn btn-icon" title="Refresh" aria-label="Refresh" @click="refresh"><Icon name="refresh" class="h-4 w-4" /></button>
      </template>
    </PageHeader>

    <div v-if="caps.loginDisabled && !caps.demo" class="callout callout-warn mb-5">
      <Icon name="alert" />
      <span>Login is disabled, so anyone who can reach homeport sees your whole fleet. Set
        <code>HOMEPORT_ADMIN_PASSWORD</code> and put it behind HTTPS.</span>
    </div>

    <!-- onboarding: no reverse proxy yet -->
    <div v-if="showGettingStarted" class="card relative mb-6 overflow-hidden">
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.09] via-transparent to-transparent" />
      <div class="relative flex items-start gap-4 p-5">
        <div class="hidden h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-light sm:grid">
          <Icon name="globe" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold text-slate-100">Put your services on real domains</h2>
          <p class="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-400">
            homeport maps each container to its URL by reading your reverse proxy, and it can install one for you.
            No proxy yet? <strong class="font-medium text-slate-200">Nginx Proxy Manager</strong> is the friendly
            default, with free HTTPS built in.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <NuxtLink to="/catalog/nginx-proxy-manager" class="btn btn-primary">Install a reverse proxy</NuxtLink>
            <button :disabled="connecting" class="btn" @click="connectProxy">
              {{ connecting ? 'Connecting…' : 'Already installed NPM? Connect it' }}
            </button>
            <NuxtLink to="/catalog" class="btn btn-ghost">Browse apps</NuxtLink>
          </div>
          <div v-if="connectMsg" class="callout mt-4" :class="connectOk ? 'callout-info' : 'callout-warn'">
            <Icon :name="connectOk ? 'check' : 'alert'" />
            <div class="min-w-0">
              {{ connectMsg }}
              <div v-if="connectSecret" class="mt-1.5 select-all rounded-md bg-black/30 px-2 py-1 font-mono text-[12px] text-slate-100">
                admin@example.com&nbsp;·&nbsp;{{ connectSecret }}
              </div>
            </div>
          </div>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm" title="Dismiss" aria-label="Dismiss" @click="dismissGettingStarted">
          <Icon name="x" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- summary tiles -->
    <ResourceBar
      v-if="data"
      :fleet="fleet"
      :running="data.stats.running"
      :total="data.stats.total"
      :updates="updatesShown ? updateCount : null"
      class="mb-5"
    />
    <div v-else-if="loading" class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div v-for="i in 4" :key="i" class="card h-[98px] p-4"><div class="skeleton h-3 w-16" /><div class="skeleton mt-3 h-6 w-20" /></div>
    </div>

    <!-- usage graph -->
    <section v-if="data" class="card mb-6">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <button class="flex items-center gap-2 text-[13px] font-semibold text-slate-100" :aria-expanded="showGraph" @click="toggleGraph">
          <Icon name="chevron-down" class="h-3.5 w-3.5 text-slate-500 transition-transform" :class="showGraph ? '' : '-rotate-90'" />
          Resource usage
        </button>
        <div v-if="showGraph" class="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-400 md:flex">
          <span v-for="s in fleetSeries" :key="s.label" class="flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />{{ s.label }}
          </span>
        </div>
        <div v-if="showGraph" class="segmented segmented-sm ml-auto">
          <button
            v-for="r in (['live', '1h', '6h', '24h'] as const)"
            :key="r"
            :aria-pressed="graphRange === r"
            @click="graphRange = r"
          >{{ r === 'live' ? 'Live' : r }}</button>
        </div>
      </div>
      <div v-if="showGraph" class="px-2 pb-3 sm:px-3">
        <LineGraph :series="fleetSeries" :shared-max="100" :interval-sec="graphIntervalSec" :height="150" bare />
      </div>
    </section>

    <!-- needs attention -->
    <section v-if="attention.length" class="card mb-6 border-amber-500/20">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <span class="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
          <Icon name="alert" class="h-4 w-4 text-amber-400" /> Needs attention
        </span>
        <div class="flex flex-wrap gap-1.5">
          <NuxtLink
            v-for="a in attention"
            :key="a.key"
            :to="a.to"
            class="chip"
          >
            <span class="dot h-1.5 w-1.5" :class="a.tone === 'red' ? 'bg-red-400' : 'bg-amber-400'" />
            <span class="font-medium text-slate-100">{{ a.name }}</span>
            <span class="text-slate-500">{{ a.reason }}</span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- toolbar -->
    <div v-if="data" class="mb-5 flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-64">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          ref="searchInput"
          v-model="q"
          type="search"
          class="input pl-8 pr-8"
          placeholder="Filter containers…"
          aria-label="Filter containers"
          @keydown.esc="q = ''; ($event.target as HTMLInputElement).blur()"
        />
        <span v-if="!q" class="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">/</span>
      </div>
      <!-- on a phone the chips share the full width evenly instead of running off the edge -->
      <div class="segmented max-w-full overflow-x-auto max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center max-sm:[&>button]:px-1.5">
        <button
          v-for="f in filters"
          :key="f.key"
          :aria-pressed="filter === f.key"
          @click="filter = f.key"
        >
          {{ f.label }}
          <span class="tabular text-[11px]" :class="filter === f.key ? 'text-slate-400' : 'text-slate-600'">{{ f.count }}</span>
        </button>
      </div>
      <div v-if="multiHost" class="segmented">
        <button :aria-pressed="hostFilter === ''" @click="hostFilter = ''">All hosts</button>
        <button
          v-for="h in hosts"
          :key="h.id"
          :aria-pressed="hostFilter === h.name"
          :title="h.online ? '' : h.error || 'unreachable'"
          @click="hostFilter = h.name"
        >
          <span class="dot h-1.5 w-1.5" :class="h.online ? 'bg-ok' : 'bg-red-400'" />{{ h.name }}
        </button>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <button
          class="btn btn-ghost btn-sm hidden sm:inline-flex"
          :title="allCollapsed ? 'Expand all groups' : 'Collapse all groups'"
          @click="setAllCollapsed(!allCollapsed)"
        >{{ allCollapsed ? 'Expand all' : 'Collapse all' }}</button>
        <div class="segmented" role="group" aria-label="Layout">
          <button :aria-pressed="view === 'grid'" title="Cards" aria-label="Card layout" @click="setView('grid')"><Icon name="grid" class="h-3.5 w-3.5" /></button>
          <button :aria-pressed="view === 'list'" title="List" aria-label="List layout" @click="setView('list')"><Icon name="list" class="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>

    <div v-if="loading && !data" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card h-28 p-4"><div class="skeleton h-4 w-32" /><div class="skeleton mt-4 h-3 w-64" /></div>
    </div>
    <div v-else-if="error" class="callout callout-danger">
      <Icon name="alert" />
      <div>
        <p class="font-medium">Could not load your containers</p>
        <p class="mt-0.5 text-red-300/80">{{ error }}</p>
        <button class="btn btn-sm mt-3" @click="refresh">Try again</button>
      </div>
    </div>

    <template v-else-if="data">
      <div v-if="!groups.length" class="card">
        <EmptyState
          v-if="visible.length"
          icon="search"
          title="No containers match"
          :text="q ? `Nothing matches “${q}” with the current filter.` : 'Nothing matches the current filter.'"
        >
          <template #actions><button class="btn btn-sm" @click="q = ''; filter = 'all'">Clear filters</button></template>
        </EmptyState>
        <EmptyState v-else icon="box" title="No containers yet" text="homeport shows every container on your Docker host here, as soon as one is running.">
          <template #actions><NuxtLink to="/catalog" class="btn btn-primary btn-sm">Install an app</NuxtLink></template>
        </EmptyState>
      </div>

      <div class="space-y-7">
        <StackGroup
          v-if="pinnedServices.length"
          name="Pinned"
          kind="pinned"
          :services="pinnedServices"
          :view="view"
          :force-open="!!q.trim() || filter !== 'all'"
        />
        <StackGroup
          v-for="g in groups"
          :key="g.key"
          :name="g.name"
          :kind="g.kind"
          :services="g.services"
          :stack="g.stack"
          :project="g.project"
          :missing="g.missing"
          :view="view"
          :force-open="!!q.trim() || filter !== 'all'"
        />
      </div>

      <section v-if="unmatched.length" class="mt-8">
        <div class="mb-2.5 flex items-baseline gap-2">
          <h2 class="section-title">Domains without a container</h2>
          <span class="text-xs text-slate-500">{{ unmatched.length }}</span>
        </div>
        <p class="mb-3 text-xs text-slate-500">Proxy routes whose upstream doesn't match any running container: a stopped app, or a typo in the proxy.</p>
        <div class="card row-list">
          <div v-for="u in unmatched" :key="u.upstream" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
            <span class="text-slate-200">{{ u.domains.join(', ') }}</span>
            <Icon name="arrow-right" class="h-3.5 w-3.5 text-slate-600" />
            <span class="font-mono text-xs text-slate-500">{{ u.upstream }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'
import type { StackInfo, GroupKind } from '~/composables/useStacks'

const { data, error, loading, refresh, start, stop } = useServices()
const stacksStore = useStacks() // declared early: watchers below run immediately
const reachApi = useProxyReach()
const stats = useStats()
const fleet = stats.host
const fleetHistory = stats.hostHistory
const systemHistory = stats.systemHistory
const updates = useUpdates()
const showGraph = ref(true) // on by default; '0' in storage hides it

// Fleet graph range. 'live' = the in-memory rolling buffer; ranges load history.
const { range: graphRange, intervalSec: graphIntervalSec, past: fleetPast, realPoints: fleetPoints, load: loadFleetHistory } = useHistoryRange('host', '1h')
const { range: sysRange, past: systemPast, load: loadSystemHistory } = useHistoryRange('host-system', '1h')
watch(graphRange, (r) => (sysRange.value = r))
function loadGraphHistory() {
  return Promise.all([loadFleetHistory(), loadSystemHistory()])
}
watch(showGraph, loadGraphHistory)
onMounted(async () => {
  await loadGraphHistory()
  // a fresh install has no history yet: a flat zero line would read as "idle"
  if (graphRange.value !== 'live' && fleetPoints.value < 2) graphRange.value = 'live'
})

const fleetSeries = computed(() => {
  const src = graphRange.value === 'live' ? fleetHistory.value : fleetPast.value ?? { cpu: [], mem: [] }
  const sys = graphRange.value === 'live' ? systemHistory.value : systemPast.value ?? { cpu: [], mem: [] }
  const out = [
    { label: 'Containers CPU', color: '#10b981', data: src.cpu, unit: '%' },
    { label: 'Containers RAM', color: '#38bdf8', data: src.mem, unit: '%' },
  ]
  // whole-machine series (procfs): shows what the host uses beyond containers
  if (sys.cpu.length) out.push({ label: 'System CPU', color: '#a78bfa', data: sys.cpu, unit: '%' })
  if (sys.mem.length) out.push({ label: 'System RAM', color: '#f59e0b', data: sys.mem, unit: '%' })
  return out
})
const pings = usePings()
const { caps } = useCapabilities()
// search, status filter and host live in the URL, so Back from a container
// page (or a reload, or a shared link) comes back to the same view
const route = useRoute()
const router = useRouter()
const q = ref(String(route.query.q ?? ''))
const hostFilter = ref(String(route.query.host ?? ''))
const searchInput = ref<HTMLInputElement | null>(null)

// Onboarding nudge: no reverse proxy detected yet, so offer to install one.
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
        ? 'Connected, proxy management is on. Save this NPM login (you can sign into NPM directly with it):'
        : 'Connected, proxy management is on.'
      setTimeout(refresh, 1500) // provider now set, so the card falls away
    } else if (r.notReady) {
      connectMsg.value = "Nginx Proxy Manager isn't reachable yet. Give it a few seconds after installing, then try again."
    } else if (r.alreadyConfigured) {
      connectMsg.value = 'NPM is already set up. Add its email and password in Settings → Reverse proxy to connect.'
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

// card grid vs dense list, remembered per browser
const view = ref<'grid' | 'list'>('grid')
function setView(v: 'grid' | 'list') {
  view.value = v
  localStorage.setItem('hp:view', v)
}

// "/" focuses the filter, like most dashboards
function onKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey) return
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable]')) return
  e.preventDefault()
  searchInput.value?.focus()
}

// stack info (compose-declared services) refreshes with the live container list
watch(() => caps.value.stacks, (on) => on && stacksStore.refresh(), { immediate: true })
let stacksTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => data.value?.generatedAt,
  () => {
    if (stacksTimer) clearTimeout(stacksTimer)
    stacksTimer = setTimeout(() => stacksStore.refresh(), 600)
  },
)

onMounted(() => {
  start()
  stats.start()
  pings.start()
  useCapabilities().load()
  updates.refresh()
  if (localStorage.getItem('hp:graph') === '0') showGraph.value = false
  if (localStorage.getItem('hp:gs') === '0') gsDismissed.value = true
  if (localStorage.getItem('hp:view') === 'list') view.value = 'list'
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  stop()
  stats.stop()
  pings.stop()
  window.removeEventListener('keydown', onKey)
})

// --- status classification (drives the filter chips and the attention strip) ---
const exitCode = (s: Service) => {
  const m = /Exited \((\d+)\)/.exec(s.statusText)
  return m ? Number(m[1]) : null
}
const isRunning = (s: Service) => s.state === 'running'
// "stopped" means actually down: a crash-looping container is restarting, not stopped
const isStopped = (s: Service) => s.state !== 'running' && s.state !== 'restarting'
// A clean exit (code 0) is usually a finished one-shot job, not a problem.
const issueOf = (s: Service): { reason: string; tone: 'red' | 'amber' } | null => {
  if (s.state === 'running' && s.health === 'unhealthy') return { reason: 'unhealthy', tone: 'red' }
  if (s.state === 'restarting') return { reason: 'restart loop', tone: 'amber' }
  if (s.state === 'dead' || s.state === 'failed') return { reason: s.state, tone: 'red' }
  const code = exitCode(s)
  if (s.state === 'exited' && code !== null && code !== 0) return { reason: `exited (${code})`, tone: 'red' }
  return null
}
const hasUpdate = (s: Service) => updates.entryFor(s)?.status === 'update'

const visible = computed<Service[]>(() =>
  (data.value?.services || []).filter((s) => !s.hidden && (!hostFilter.value || s.host === hostFilter.value)),
)
// A running container whose domain answers 5xx or nothing: the app is up, yet
// nobody can use it. Skipped when a state problem or the reach check explains it.
const domainIssueOf = (s: Service): { reason: string; tone: 'amber' } | null => {
  if (s.state !== 'running' || issueOf(s) || reachApi.domainReach(s).ok === false) return null
  for (const d of s.domains) {
    const p = pings.pings.value[d.url]
    if (p && (p.status === 0 || p.status >= 500)) return { reason: p.status === 0 ? `${d.domain} doesn't answer` : `${d.domain} answers ${p.status}`, tone: 'amber' }
  }
  return null
}
// containers the attention strip lists, so the Issues filter shows exactly those
const inAttention = (s: Service) => !!issueOf(s) || reachApi.domainReach(s).ok === false || !!domainIssueOf(s)

// Containers in trouble, plus stacks that are partly up because a service in
// their compose file never got a container (a failed start, not a deliberate down).
const attention = computed(() => [
  ...visible.value.flatMap((s) => {
    const i = issueOf(s)
    return i ? [{ key: s.id, name: s.displayName, to: `/services/${encodeURIComponent(s.id)}`, ...i }] : []
  }),
  // domains the reverse proxy can't deliver: it shares no network with the container
  ...visible.value.flatMap((s) =>
    reachApi.domainReach(s).ok === false
      ? [{ key: `reach:${s.id}`, name: s.displayName, to: `/services/${encodeURIComponent(s.id)}`, reason: "proxy can't reach it", tone: 'amber' as const }]
      : [],
  ),
  ...visible.value.flatMap((s) => {
    const i = domainIssueOf(s)
    return i ? [{ key: `domain:${s.id}`, name: s.displayName, to: `/services/${encodeURIComponent(s.id)}`, ...i }] : []
  }),
  ...stacksStore.stacks.value
    .filter((st) => st.running > 0 && st.missing?.length)
    .map((st) => ({
      key: `stack:${st.name}`,
      name: st.name,
      to: `/stacks/${encodeURIComponent(st.name)}`,
      reason: `${st.missing!.map((m) => m.name).join(', ')} not running`,
      tone: 'amber' as const,
    })),
])
const updateCount = computed(() => visible.value.filter(hasUpdate).length)
const updatesShown = computed(() => caps.value.updateCheck || caps.value.updates || updates.enabled.value)

type Filter = 'all' | 'running' | 'stopped' | 'issues' | 'updates'
const FILTER_KEYS: Filter[] = ['all', 'running', 'stopped', 'issues', 'updates']
const filter = ref<Filter>(FILTER_KEYS.includes(route.query.status as Filter) ? (route.query.status as Filter) : 'all')
watch([q, filter, hostFilter], () => {
  const query: Record<string, string> = {}
  if (q.value.trim()) query.q = q.value.trim()
  if (filter.value !== 'all') query.status = filter.value
  if (hostFilter.value) query.host = hostFilter.value
  router.replace({ query })
})
const filters = computed(() => {
  const v = visible.value
  const out: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: v.length + missingTotal.value },
    { key: 'running', label: 'Running', count: v.filter(isRunning).length },
    { key: 'stopped', label: 'Stopped', count: v.filter(isStopped).length + missingTotal.value },
  ]
  if (attention.value.length || filter.value === 'issues') out.push({ key: 'issues', label: 'Issues', count: attention.value.length })
  if (updateCount.value || filter.value === 'updates') out.push({ key: 'updates', label: 'Updates', count: updateCount.value })
  return out
})

const filtered = computed<Service[]>(() => {
  const term = q.value.trim().toLowerCase()
  return visible.value.filter((s) => {
    if (filter.value === 'running' && !isRunning(s)) return false
    if (filter.value === 'stopped' && !isStopped(s)) return false
    if (filter.value === 'issues' && !inAttention(s)) return false
    if (filter.value === 'updates' && !hasUpdate(s)) return false
    if (!term) return true
    return [s.displayName, s.name, s.image, s.group, s.host, ...s.domains.map((d) => d.domain)]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

// --- grouping: a dashboard group IS a stack -------------------------------
// Compose containers group by their stack; a hub.group label still files a
// container under a custom group; containers started on their own go to
// "Standalone containers"; systemd units to "Host services". Managed stacks
// also carry the services their compose file declares but that have no
// container, so a stack that was taken down doesn't vanish from the dashboard.
const STANDALONE = 'Standalone containers'
const primaryHostId = computed(() => data.value?.hosts?.[0]?.id ?? 'default')
// stacks live on the primary host; with a single host everything is on it
const onPrimary = (s: Service) => {
  if (!multiHost.value || s.kind !== 'container') return true
  const sep = s.id.indexOf('::')
  return sep < 0 || s.id.slice(0, sep) === primaryHostId.value
}

interface Group {
  key: string
  name: string
  kind: GroupKind
  services: Service[]
  stack: StackInfo | null
  project: string | null
  missing: { name: string; image?: string }[]
  order: number
}

function classify(s: Service): Omit<Group, 'services' | 'missing'> {
  // in the multi-host "All" view, prefix with the host so same-named stacks don't merge
  const prefix = multiHost.value && !hostFilter.value && s.host ? `${s.host} · ` : ''
  if (s.kind === 'systemd') return { key: `host:${prefix}`, name: `${prefix}Host services`, kind: 'host', stack: null, project: null, order: 2 }
  const custom = !!s.group && s.group !== (s.project || 'Other')
  if (custom) return { key: `custom:${prefix}${s.group}`, name: `${prefix}${s.group}`, kind: 'custom', stack: null, project: null, order: 1 }
  if (s.project) {
    const stack = onPrimary(s) ? stacksStore.byName(s.project) : null
    // without the stacks capability (or before the list loads) a project is just a stack we can't operate
    const kind: GroupKind = stack || !caps.value.stacks || !stacksStore.loaded.value ? 'stack' : 'unmanaged'
    return { key: `stack:${prefix}${s.project}`, name: `${prefix}${s.project}`, kind, stack, project: s.project, order: 1 }
  }
  return { key: `standalone:${prefix}`, name: `${prefix}${STANDALONE}`, kind: 'standalone', stack: null, project: null, order: 3 }
}

// not-running (declared, no container) services show under All and Stopped, and
// under Issues when the rest of their stack is up (that's a failed start)
function missingFor(stack: StackInfo | null) {
  if (!stack?.missing?.length) return []
  const f = filter.value
  if (!(f === 'all' || f === 'stopped' || (f === 'issues' && stack.running > 0))) return []
  const term = q.value.trim().toLowerCase()
  return stack.missing.filter((m) => !term || `${stack.name} ${m.name} ${m.image ?? ''}`.toLowerCase().includes(term))
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>()
  for (const s of filtered.value) {
    const c = classify(s)
    const g = map.get(c.key) || { ...c, services: [], missing: [] }
    g.services.push(s)
    map.set(c.key, g)
  }
  for (const g of map.values()) g.missing = missingFor(g.stack)
  // managed stacks with no container left at all (taken down) still get a group
  const primaryShown = !hostFilter.value || hosts.value[0]?.name === hostFilter.value
  if (primaryShown) {
    for (const st of stacksStore.stacks.value) {
      const prefix = multiHost.value && !hostFilter.value ? `${hosts.value[0]?.name} · ` : ''
      const key = `stack:${prefix}${st.name}`
      if (map.has(key)) continue
      const missing = missingFor(st)
      if (missing.length) map.set(key, { key, name: `${prefix}${st.name}`, kind: 'stack', services: [], stack: st, project: st.name, missing, order: 1 })
    }
  }
  return [...map.values()]
    .map((g) => ({ ...g, services: g.services.sort((a, b) => a.displayName.localeCompare(b.displayName)) }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
})

const missingTotal = computed(() =>
  !hostFilter.value || hosts.value[0]?.name === hostFilter.value
    ? stacksStore.stacks.value.reduce((n, s) => n + (s.missing?.length ?? 0), 0)
    : 0,
)

// pinned containers (per browser, by name) get their own group at the top
const pins = usePins()
const pinnedServices = computed(() =>
  filtered.value.filter((s) => pins.isPinned(s.name)).sort((a, b) => a.displayName.localeCompare(b.displayName)),
)

// collapse/expand every group at once (StackGroup persists per-group state in localStorage)
const collapsedTick = useState('hp:collapse-tick', () => 0)
const allCollapsed = computed(() => {
  collapsedTick.value // re-evaluate after a toggle
  if (!import.meta.client || !groups.value.length) return false
  return groups.value.every((g) => localStorage.getItem(`hp:collapsed:${g.name}`) === '1')
})
function setAllCollapsed(v: boolean) {
  for (const g of groups.value) localStorage.setItem(`hp:collapsed:${g.name}`, v ? '1' : '0')
  collapsedTick.value++
}

const unmatched = computed(() => {
  const term = q.value.trim().toLowerCase()
  const list = data.value?.unmatched || []
  if (filter.value !== 'all') return []
  if (!term) return list
  return list.filter((u) => (u.domains.join(' ') + u.upstream).toLowerCase().includes(term))
})

// the tab title carries the problem count, so a background tab still tells you
useHead({ title: computed(() => (attention.value.length ? `(${attention.value.length}) homeport` : 'homeport')) })
</script>
