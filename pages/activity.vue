<template>
  <div class="mx-auto max-w-[900px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-wrap items-center gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">Activity</h1>
        <p class="mt-1 text-[13px] text-slate-500">What happened while you were away — alerts, updates, operations.</p>
      </div>
      <button
        class="ml-auto rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
        :disabled="loading"
        @click="load"
      >{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </header>

    <div class="mb-4 flex flex-wrap gap-1.5 text-[11px]">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        class="rounded-full border px-2.5 py-1"
        :class="filter === f.key ? 'border-accent/50 bg-accent/10 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
        @click="filter = f.key"
      >{{ f.label }}</button>
    </div>

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>
    <div v-else-if="!loaded" class="py-20 text-center text-slate-500">Loading…</div>
    <p v-else-if="!rows.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
      Nothing yet — state changes, update notifications and operations will show up here.
    </p>

    <ol v-else class="space-y-1.5">
      <li
        v-for="(r, i) in rows"
        :key="i"
        class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 text-sm"
      >
        <Icon :name="r.icon" class="h-4 w-4 shrink-0" :class="r.cls" />
        <span class="min-w-0 flex-1 truncate text-slate-200">{{ r.text }}</span>
        <span v-if="r.host" class="shrink-0 rounded-full border border-white/10 px-1.5 py-px text-[10px] text-slate-500">{{ r.host }}</span>
        <span class="shrink-0 text-[11px] text-slate-500" :title="new Date(r.at).toLocaleString()">{{ ago(r.at) }}</span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
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

interface Row { at: number; icon: string; cls: string; text: string; host?: string; group: Filter }

function eventRow(e: AlertRow): Row {
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
    text: `${o.title}${o.done ? (o.ok ? ` finished${dur}` : ` failed${dur}`) : ' — running…'}`,
    group: 'ops',
  }
}

const rows = computed(() => {
  const all = [...events.value.map(eventRow), ...opsList.value.map(opRow)].sort((a, b) => b.at - a.at)
  return filter.value === 'all' ? all : all.filter((r) => r.group === filter.value)
})

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 90) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

onMounted(load)
useHead({ title: 'Activity — homeport' })
</script>
