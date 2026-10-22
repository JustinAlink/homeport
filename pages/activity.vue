<template>
  <div class="page-narrow">
    <PageHeader title="Activity" subtitle="What happened while you were away: alerts, updates and operations.">
      <template #actions>
        <button class="btn" :disabled="loading" @click="load"><Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> Refresh</button>
      </template>
    </PageHeader>

    <div class="segmented mb-5">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        :aria-pressed="filter === f.key"
        @click="filter = f.key"
      >{{ f.label }}</button>
    </div>

    <div v-if="error" class="callout callout-warn">{{ error }}</div>
    <div v-else-if="!loaded" class="card h-64" />
    <div v-else-if="!rows.length" class="card">
      <EmptyState icon="pulse" title="Nothing yet" text="State changes, update notifications and operations show up here as they happen." />
    </div>

    <ol v-else class="card row-list overflow-hidden">
      <li v-for="(r, i) in rows" :key="i">
        <component
          :is="linkFor(r) ? NuxtLinkC : 'div'"
          v-bind="linkFor(r) ? { to: linkFor(r) } : {}"
          class="group flex items-center gap-3 px-4 py-3 text-[13.5px] sm:px-5"
          :class="linkFor(r) ? 'transition-colors hover:bg-white/[0.025]' : ''"
        >
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.04]"><Icon :name="r.icon" class="h-3.5 w-3.5" :class="r.cls" /></span>
          <span class="line-clamp-2 min-w-0 flex-1 text-slate-200 sm:truncate" :class="linkFor(r) ? 'group-hover:text-accent-light' : ''" :title="r.text">{{ r.text }}</span>
          <span v-if="r.host" class="badge shrink-0">{{ r.host }}</span>
          <span class="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500" :title="new Date(r.at).toLocaleString()">{{ ago(r.at) }}</span>
          <Icon v-if="linkFor(r)" name="chevron-right" class="hidden h-4 w-4 shrink-0 text-slate-600 group-hover:text-slate-300 sm:block" />
        </component>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { NuxtLink as NuxtLinkC } from '#components'

interface AlertRow { id: string; name: string; host?: string; kind: string; from: string; to: string; at: number }
interface OpRow { id: string; title: string; done: boolean; ok: boolean | null; startedAt: number; finishedAt: number }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'status', label: 'Status changes' },
  { key: 'updates', label: 'Updates' },
  { key: 'ops', label: 'Operations' },
] as const
type Filter = (typeof FILTERS)[number]['key']
const filter = ref<Filter>('all')

const events = ref<AlertRow[]>([])
const opsList = ref<OpRow[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  try {
    const r = await $fetch<{ events: AlertRow[]; ops: OpRow[] }>('/api/activity')
    events.value = r.events ?? []
    opsList.value = r.ops ?? []
    error.value = ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not load the activity feed')
  } finally {
    loaded.value = true
    loading.value = false
  }
}

interface Row { at: number; icon: string; cls: string; text: string; host?: string; group: Filter; name?: string; stack?: string }

function eventRow(e: AlertRow): Row {
  return { ...eventRowBase(e), name: e.name }
}
function eventRowBase(e: AlertRow): Row {
  switch (e.kind) {
    case 'down':
      return { at: e.at, icon: 'x', cls: 'text-red-400', text: `${e.name} went down (${e.from} → ${e.to})`, host: e.host, group: 'status' }
    case 'unhealthy':
      return { at: e.at, icon: 'alert', cls: 'text-amber-300', text: `${e.name} became unhealthy`, host: e.host, group: 'status' }
    case 'recovered':
      return { at: e.at, icon: 'check', cls: 'text-ok', text: `${e.name} recovered (${e.from} → ${e.to})`, host: e.host, group: 'status' }
    case 'update':
      return { at: e.at, icon: 'arrow-up', cls: 'text-sky-300', text: `update available for ${e.name} (${e.from})`, host: e.host, group: 'updates' }
    case 'updated':
      return e.to
        ? { at: e.at, icon: 'x', cls: 'text-red-400', text: `auto-update of ${e.name} failed — ${e.to}`, host: e.host, group: 'updates' }
        : { at: e.at, icon: 'arrow-up', cls: 'text-ok', text: `${e.name} auto-updated`, host: e.host, group: 'updates' }
    default:
      return { at: e.at, icon: 'alert', cls: 'text-slate-400', text: `${e.name}: ${e.kind}`, host: e.host, group: 'status' }
  }
}

function opRow(o: OpRow): Row {
  const dur = o.done && o.finishedAt ? ` (${Math.max(1, Math.round((o.finishedAt - o.startedAt) / 1000))}s)` : ''
  return {
    at: o.startedAt,
    icon: o.done ? (o.ok ? 'check' : 'x') : 'refresh',
    cls: o.done ? (o.ok ? 'text-ok' : 'text-red-400') : 'animate-spin text-amber-300',
    text: `${o.title}${o.done ? (o.ok ? ` finished${dur}` : ` failed${dur}`) : ', running…'}`,
    group: 'ops',
    // op titles are "<verb> <stack>"; a deleted stack has no page to open
    stack: /^delete /.test(o.title) ? undefined : o.title.split(' ').pop(),
  }
}

const rows = computed(() => {
  const all = [...events.value.map(eventRow), ...opsList.value.map(opRow)].sort((a, b) => b.at - a.at)
  return filter.value === 'all' ? all : all.filter((r) => r.group === filter.value)
})

// Rows open what they're about: the container (matched by name in the live list,
// since ids change on every recreate), or the stack an operation ran on.
const { data: svc, refresh: refreshServices } = useServices()
function linkFor(r: Row): string | null {
  if (r.stack) return `/stacks/${encodeURIComponent(r.stack)}`
  if (!r.name) return null
  const stackMatch = /^stack (.+)$/.exec(r.name)
  if (stackMatch) return `/stacks/${encodeURIComponent(stackMatch[1])}`
  const s = (svc.value?.services ?? []).find((x) => x.name === r.name && (!r.host || !x.host || x.host === r.host))
  return s ? `/services/${encodeURIComponent(s.id)}` : null
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 90) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

onMounted(() => {
  load()
  if (!svc.value) refreshServices()
})
useHead({ title: 'Activity · homeport' })
</script>
