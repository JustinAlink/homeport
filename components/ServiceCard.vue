<template>
  <div
    class="group relative flex flex-col gap-1.5 rounded-md px-2.5 py-2 transition-colors hover:bg-white/[0.03]"
    :class="{ 'opacity-60': service.state !== 'running' && service.kind === 'container' }"
  >
    <!-- top: logo · name + subtitle · control · status -->
    <div class="flex items-center gap-2.5">
      <ServiceIcon :name="service.displayName" :icon="service.icon" :size="32" :remote="remoteIcons" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-slate-100" :title="service.name">{{ service.displayName }}</div>
        <div class="truncate text-[11px] text-slate-500" :class="service.kind === 'systemd' ? 'italic' : 'font-mono'" :title="service.image">
          {{ service.image }}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="controlEnabled && service.kind === 'container'"
          :disabled="busy"
          class="rounded border px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
          :class="isUp ? 'border-red-500/20 text-red-300 hover:bg-red-500/10' : 'border-accent/25 text-accent-light hover:bg-accent/10'"
          @click="control(isUp ? 'stop' : 'start')"
        >{{ busy ? '…' : isUp ? 'Stop' : 'Start' }}</button>
        <StatusPill :state="service.state" :health="service.health" />
      </div>
    </div>

    <!-- domains + ports -->
    <div v-if="service.domains.length || service.ports.length" class="flex flex-wrap items-center gap-1 pl-[42px]">
      <a
        v-for="d in service.domains"
        :key="d.domain"
        :href="d.url"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent-light hover:bg-accent/20"
      >
        <span v-if="pings[d.url]" class="h-1.5 w-1.5 rounded-full" :class="pingClass(d.url)" :title="pingTitle(d.url)" />
        <span v-if="d.ssl" class="text-[9px]" title="SSL">🔒</span>
        <span class="max-w-[12rem] truncate">{{ d.domain }}</span>
      </a>
      <a
        v-for="p in service.ports"
        :key="p.hostPort + p.type"
        :href="`http://${host}:${p.hostPort}`"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-white/10"
      >:{{ p.hostPort }}</a>
    </div>

    <!-- metrics (running container) — sparkline toggles the detail graph -->
    <div v-if="stat && service.state === 'running'" class="flex items-center gap-2 pl-[42px] text-[11px] text-slate-500">
      <span class="text-slate-400">{{ stat.cpuPercent != null ? stat.cpuPercent + '%' : '—' }}</span>
      <button
        v-if="cpuHistory.length > 1"
        class="relative h-4 w-14 rounded hover:bg-white/5"
        :class="expanded ? 'bg-white/5' : ''"
        title="CPU + RAM — click to expand"
        @click="expanded = !expanded"
      >
        <span class="absolute inset-0"><Sparkline :data="cpuHistory" color="#10b981" /></span>
        <span v-if="memHistory.length > 1" class="absolute inset-0"><Sparkline :data="memHistory" color="#38bdf8" /></span>
      </button>
      <span>{{ formatBytes(stat.memBytes) }}</span>
      <span v-if="stat.memPercent != null" class="text-slate-600">· {{ stat.memPercent }}%</span>
    </div>
    <!-- non-running / systemd status -->
    <p v-else class="truncate pl-[42px] text-[11px] text-slate-500">{{ service.statusText }}</p>

    <!-- per-card detail graph -->
    <LineGraph v-if="expanded && cpuHistory.length > 1" :series="cardSeries" :height="96" class="mt-1" />
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = defineProps<{ service: Service }>()
const host = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const expanded = ref(false)

const { stats, history, refresh: refreshStats } = useStats()
const stat = computed(() => stats.value[props.service.id])
const cpuHistory = computed(() => history.value[props.service.id]?.cpu ?? [])
const memHistory = computed(() => history.value[props.service.id]?.mem ?? [])
const cardSeries = computed(() => [
  { label: 'CPU', color: '#10b981', data: cpuHistory.value, unit: '%' },
  { label: 'MEM', color: '#38bdf8', data: memHistory.value, unit: 'MiB' },
])

const { pings } = usePings()
function pingClass(url: string) {
  const p = pings.value[url]
  if (!p) return ''
  if (p.status === 0) return 'bg-red-400'
  if (p.status < 400) return 'bg-accent'
  return 'bg-amber-400'
}
function pingTitle(url: string) {
  const p = pings.value[url]
  return !p ? '' : p.status === 0 ? 'unreachable' : `HTTP ${p.status} · ${p.ms}ms`
}

const { data, refresh: refreshServices } = useServices()
const controlEnabled = computed(() => data.value?.controlEnabled ?? false)
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const isUp = computed(() => props.service.state === 'running' || props.service.state === 'restarting')
const busy = ref(false)
async function control(action: 'start' | 'stop') {
  if (action === 'stop' && !window.confirm(`Stop “${props.service.displayName}”?`)) return
  busy.value = true
  try {
    await $fetch('/api/control', { method: 'POST', body: { id: props.service.id, action } })
    await refreshServices()
    refreshStats()
  } catch (e: any) {
    window.alert(e?.statusMessage || e?.message || 'Action failed')
  } finally {
    busy.value = false
  }
}
</script>
