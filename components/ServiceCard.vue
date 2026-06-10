<template>
  <div
    class="flex flex-col gap-3 rounded-lg border border-white/5 bg-ink-900 p-4 transition-colors hover:border-white/10"
    :class="{ 'opacity-60': service.state !== 'running' }"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="truncate font-semibold text-slate-100" :title="service.name">
          <span v-if="service.icon" class="mr-1">{{ service.icon }}</span>{{ service.displayName }}
        </h3>
        <p
          class="truncate text-[11px] text-slate-500"
          :class="service.kind === 'systemd' ? 'italic' : 'font-mono'"
          :title="service.image"
        >
          {{ service.image }}
        </p>
      </div>
      <StatusPill :state="service.state" :health="service.health" />
    </div>

    <!-- Domains -->
    <div v-if="service.domains.length" class="flex flex-wrap gap-1.5">
      <a
        v-for="d in service.domains"
        :key="d.domain"
        :href="d.url"
        target="_blank"
        rel="noopener noreferrer"
        class="group inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent-light hover:bg-accent/20"
      >
        <span
          v-if="pings[d.url]"
          class="h-1.5 w-1.5 rounded-full"
          :class="pingClass(d.url)"
          :title="pingTitle(d.url)"
        />
        <span v-if="d.ssl" title="SSL" class="text-[10px]">🔒</span>
        <span class="truncate max-w-[14rem]">{{ d.domain }}</span>
        <span class="opacity-0 transition-opacity group-hover:opacity-100">↗</span>
      </a>
    </div>

    <!-- Host ports (for services with no domain, or extra ports) -->
    <div v-if="service.ports.length" class="flex flex-wrap gap-1.5">
      <a
        v-for="p in service.ports"
        :key="p.hostPort + p.type"
        :href="`http://${host}:${p.hostPort}`"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-white/10"
        :title="`host ${p.hostPort} → container ${p.containerPort}/${p.type}`"
      >
        :{{ p.hostPort }}
      </a>
    </div>

    <div class="mt-auto space-y-1.5 pt-1">
      <div v-if="stat && service.state === 'running'" class="flex items-center gap-3 text-[11px] text-slate-400">
        <span><span class="text-slate-500">CPU</span> {{ stat.cpuPercent != null ? stat.cpuPercent + '%' : '—' }}</span>
        <span>
          <span class="text-slate-500">MEM</span> {{ formatBytes(stat.memBytes) }}<span
            v-if="stat.memPercent != null"
            class="text-slate-600"
          > · {{ stat.memPercent }}%</span>
        </span>
        <div v-if="cpuHistory.length > 1" class="ml-auto h-4 w-16 opacity-80">
          <Sparkline :data="cpuHistory" />
        </div>
      </div>
      <div class="flex items-center justify-between gap-2">
        <p class="truncate text-[11px] text-slate-500" :title="service.statusText">
          {{ service.statusText }}
        </p>
        <button
          v-if="controlEnabled && service.kind === 'container'"
          :disabled="busy"
          class="shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50"
          :class="isUp
            ? 'border-red-500/20 text-red-300 hover:bg-red-500/10'
            : 'border-accent/25 text-accent-light hover:bg-accent/10'"
          @click="control(isUp ? 'stop' : 'start')"
        >
          {{ busy ? '…' : isUp ? 'Stop' : 'Start' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = defineProps<{ service: Service }>()

// Best-effort host for port links: wherever the dashboard itself is opened.
const host = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))

const { stats, history, refresh: refreshStats } = useStats()
const stat = computed(() => stats.value[props.service.id])
const cpuHistory = computed(() => history.value[props.service.id]?.cpu ?? [])

const { pings } = usePings()
function pingClass(url: string): string {
  const p = pings.value[url]
  if (!p) return ''
  if (p.status === 0) return 'bg-red-400'
  if (p.status < 400) return 'bg-accent'
  return 'bg-amber-400'
}
function pingTitle(url: string): string {
  const p = pings.value[url]
  if (!p) return ''
  return p.status === 0 ? 'unreachable' : `HTTP ${p.status} · ${p.ms}ms`
}

const { data, refresh: refreshServices } = useServices()
const controlEnabled = computed(() => data.value?.controlEnabled ?? false)
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
