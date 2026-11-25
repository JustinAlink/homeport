<template>
  <div class="page">
    <PageHeader title="Exposure" subtitle="How each running app can be reached: by its domain through your reverse proxy, or straight through a port on the machine.">
      <template #actions>
        <span v-if="data && !probing" class="hidden text-xs text-slate-500 sm:inline" :title="new Date(data.at).toLocaleString()">checked {{ checkedAgo }}</span>
        <button class="btn" :disabled="probing" @click="refresh"><Icon name="refresh" :class="probing ? 'animate-spin' : ''" /> {{ probing ? 'Checking…' : 'Check again' }}</button>
      </template>
    </PageHeader>

    <div v-if="error" class="callout callout-warn mb-5"><Icon name="alert" /><span>{{ error }}</span></div>

    <!-- loading -->
    <div v-if="!data && !error" class="space-y-4" aria-busy="true">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><div v-for="i in 5" :key="i" class="card h-[92px]" /></div>
      <div class="card h-40" />
      <div class="card h-40" />
    </div>

    <template v-else-if="data">
      <p v-if="!data.pingEnabled" class="callout callout-info mb-5">
        <Icon name="info" />
        <span>Domain checks are off (<code>HOMEPORT_PING=false</code>), so homeport can't tell which domains ask for a login or redirect plain HTTP to HTTPS. Ports and routes are still read from Docker and your proxy.</span>
      </p>

      <!-- the summary is also the filter -->
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Filter by level">
        <button
          v-for="lvl in EXPOSURE_LEVELS"
          :key="lvl"
          type="button"
          class="card group flex flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:border-white/20"
          :class="[filter === lvl ? '!border-accent/60 bg-white/[0.03]' : '', data.summary[lvl] ? '' : 'opacity-60']"
          :aria-pressed="filter === lvl"
          @click="toggleFilter(lvl)"
        >
          <span class="flex items-center gap-2 text-[12px] font-medium text-slate-400">
            <span class="dot" :class="EXPOSURE_META[lvl].dot" />{{ EXPOSURE_META[lvl].label }}
          </span>
          <span class="text-2xl font-semibold tabular-nums" :class="data.summary[lvl] && (lvl === 'risk' || lvl === 'warn') ? EXPOSURE_META[lvl].text : 'text-slate-100'">{{ data.summary[lvl] }}</span>
          <span class="hidden text-[11.5px] leading-snug text-slate-500 sm:block">{{ EXPOSURE_META[lvl].hint }}</span>
        </button>
      </div>

      <div v-if="data.services.length" class="mb-4 flex flex-wrap items-center gap-3">
        <div class="relative min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <label for="exposure-search" class="sr-only">Search apps, domains and ports</label>
          <input id="exposure-search" v-model="query" class="input pl-8" placeholder="Search apps, domains, ports" />
        </div>
        <p v-if="filter" class="flex items-center gap-2 text-xs text-slate-500">
          Showing <span class="text-slate-300">{{ EXPOSURE_META[filter].label.toLowerCase() }}</span>
          <button type="button" class="link" @click="toggleFilter(filter)">show all</button>
        </p>
        <p v-if="probing" class="ml-auto flex items-center gap-2 text-xs text-slate-500"><span class="dot h-1.5 w-1.5 animate-pulse bg-sky-400" />asking each domain what a visitor gets…</p>
      </div>

      <div v-if="!data.services.length" class="card">
        <EmptyState icon="shield" title="Nothing running" text="Start a container and its domains and ports show up here." />
      </div>
      <div v-else-if="!groups.length" class="card">
        <EmptyState icon="search" :title="query ? `Nothing matches “${query.trim()}”` : 'Nothing at this level'">
          <template #actions><button class="btn btn-sm" @click="clearAll">Show everything</button></template>
        </EmptyState>
      </div>

      <section v-for="g in groups" :key="g.level" class="mb-7" :aria-labelledby="`lvl-${g.level}`">
        <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 :id="`lvl-${g.level}`" class="section-title"><span class="dot" :class="EXPOSURE_META[g.level].dot" />{{ EXPOSURE_META[g.level].label }}</h2>
          <span class="text-xs text-slate-500">{{ g.items.length }} · {{ EXPOSURE_META[g.level].hint }}</span>
          <button
            v-if="g.collapsible"
            type="button"
            class="ml-auto text-xs text-slate-500 hover:text-slate-200"
            :aria-expanded="expanded.has(g.level)"
            @click="toggleExpanded(g.level)"
          >{{ expanded.has(g.level) ? 'Hide' : `Show ${g.items.length}` }}</button>
        </div>
        <div v-if="!g.collapsible || expanded.has(g.level)" class="card row-list overflow-hidden">
          <ExposureItem
            v-for="e in g.items"
            :key="e.id"
            :e="e"
            :probing="probing"
            :can-accept="!caps.viewer"
            :stack="stackFor(e.id)"
            :icon="iconFor(e.id)"
            :remote="svcData?.remoteIcons ?? true"
            @changed="load({ probe: true })"
          />
        </div>
      </section>

      <details class="card card-pad mt-2 text-[12.5px] leading-relaxed text-slate-400">
        <summary class="cursor-pointer text-[13px] font-medium text-slate-200">How homeport works this out</summary>
        <ul class="mt-2.5 list-disc space-y-1.5 pl-5">
          <li><span class="text-slate-300">Ports</span> come from Docker: each published port and the address it listens on. “Every interface” means every network interface of the machine; whether that includes the internet depends on your router or cloud firewall, which homeport can't see.</li>
          <li><span class="text-slate-300">Domains</span> come from your reverse proxy's configuration, HTTPS included.</li>
          <li><span class="text-slate-300">Login and HTTP redirect</span>: homeport asks each domain for its front page like an anonymous visitor would, and once more over plain http://. A login page or a redirect to a sign-in portal counts as a login. An app with its own login behind a page that opens for anyone can't be told apart from one without, so that is shown as a fact, not flagged.</li>
          <li>Accepting a finding only stops it counting; nothing in your setup changes.</li>
        </ul>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ExposureLevel, ServiceExposure } from '~/shared/utils/exposure'
import { EXPOSURE_LEVELS } from '~/shared/utils/exposure'

const route = useRoute()
const router = useRouter()
const { caps, load: loadCaps } = useCapabilities()
const { data: svcData } = useServices()
const stacksStore = useStacks()
const { data, probing, error, refresh, load } = useExposure()
const acks = useExposureAcks()

// ?level= keeps the filter in the URL, so a link or reload lands on the same view
const filter = computed<ExposureLevel | null>(() => {
  const l = String(route.query.level || '')
  return (EXPOSURE_LEVELS as string[]).includes(l) ? (l as ExposureLevel) : null
})
function toggleFilter(l: ExposureLevel) {
  router.replace({ query: { ...route.query, level: filter.value === l ? undefined : l } })
}
const query = ref('')
function clearAll() {
  query.value = ''
  router.replace({ query: { ...route.query, level: undefined } })
}

// the quiet group starts folded so the rows that matter stay on screen
const expanded = ref(new Set<ExposureLevel>(['risk', 'warn', 'open', 'proxied']))
function toggleExpanded(l: ExposureLevel) {
  const next = new Set(expanded.value)
  if (next.has(l)) next.delete(l)
  else next.add(l)
  expanded.value = next
}

function matches(e: ServiceExposure, q: string): boolean {
  if (!q) return true
  const hay = [e.name, e.image, e.host ?? '', ...e.routes.map((r) => r.domain), ...e.ports.map((p) => `:${p.hostPort}`)].join(' ').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((t) => hay.includes(t))
}

const groups = computed(() => {
  const list = data.value?.services ?? []
  const q = query.value.trim()
  return EXPOSURE_LEVELS.filter((l) => !filter.value || filter.value === l)
    .map((level) => ({
      level,
      items: list.filter((e) => e.level === level && matches(e, q)),
      // a filter or a search is an explicit ask: never hide what it found
      collapsible: level === 'internal' && !filter.value && !q,
    }))
    .filter((g) => g.items.length)
})

const svcById = computed(() => new Map((svcData.value?.services ?? []).map((s) => [s.id, s])))
const iconFor = (id: string) => svcById.value.get(id)?.icon ?? null
const stackFor = (id: string) => {
  const project = svcById.value.get(id)?.project
  return project && stacksStore.isManaged(project) ? project : null
}

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
const checkedAgo = computed(() => {
  const s = Math.max(0, Math.round((now.value - (data.value?.at ?? now.value)) / 1000))
  return s < 10 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
})

onMounted(() => {
  refresh()
  acks.refresh()
  loadCaps().then(() => stacksStore.refresh())
  clock = setInterval(() => (now.value = Date.now()), 10_000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})

useHead({ title: 'Exposure · homeport' })
</script>
