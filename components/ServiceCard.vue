<template>
  <div
    class="group relative rounded-xl px-3.5 py-3 transition-colors hover:bg-white/[0.04]"
    :class="{ 'opacity-60': service.state !== 'running' && service.kind === 'container' }"
  >
    <div class="flex items-center gap-3.5">
      <div class="relative shrink-0">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04]">
          <ServiceIcon :name="service.displayName" :icon="service.icon" :size="26" :remote="remoteIcons" />
        </div>
        <NuxtLink
          v-if="updateAvailable"
          :to="`/services/${encodeURIComponent(service.id)}`"
          class="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-sky-400/90 text-ink-950"
          title="Update available"
        ><Icon name="arrow-up" class="h-2.5 w-2.5" :weight="2.5" /></NuxtLink>
      </div>

      <!-- name + primary domain -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="service.kind === 'container'"
            :to="`/services/${encodeURIComponent(service.id)}`"
            class="truncate text-sm font-medium text-slate-100 hover:text-accent-light"
            :title="service.image"
          >{{ service.displayName }}</NuxtLink>
          <span v-else class="truncate text-sm font-medium text-slate-100" :title="service.image">{{ service.displayName }}</span>
        </div>
        <div class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <template v-if="primaryDomain">
            <span v-if="pings[primaryDomain.url]" class="h-1.5 w-1.5 shrink-0 rounded-full" :class="pingClass(primaryDomain.url)" :title="pingTitle(primaryDomain.url)" />
            <a :href="primaryDomain.url" target="_blank" rel="noopener noreferrer" class="truncate hover:text-accent-light hover:underline">{{ primaryDomain.domain }}</a>
            <span v-if="service.domains.length > 1" class="shrink-0 text-slate-600">+{{ service.domains.length - 1 }}</span>
          </template>
          <span v-else-if="service.state !== 'running'" class="truncate">{{ service.statusText }}</span>
          <span v-else class="truncate text-slate-600">{{ service.image }}</span>
        </div>
      </div>

      <!-- hover controls -->
      <div class="flex shrink-0 items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
        <button
          v-if="caps.logs && service.kind === 'container'"
          class="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-white/5"
          title="View logs"
          @click="showLogs = true"
        >Logs</button>
        <button
          v-if="controlEnabled && service.kind === 'container' && isUp"
          :disabled="busy"
          class="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50"
          title="Restart"
          @click="control('restart')"
        ><Icon name="refresh" class="h-3 w-3" /></button>
        <button
          v-if="controlEnabled && service.kind === 'container'"
          :disabled="busy"
          class="rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
          :class="isUp ? 'border-red-500/20 text-red-300 hover:bg-red-500/10' : 'border-ok/25 text-ok hover:bg-ok/10'"
          @click="control(isUp ? 'stop' : 'start')"
        >{{ busy ? '…' : isUp ? 'Stop' : 'Start' }}</button>
      </div>

      <!-- usage bars (running containers) -->
      <div v-if="stat && service.state === 'running'" class="hidden w-36 shrink-0 flex-col gap-1.5 sm:flex">
        <div class="flex items-center gap-2">
          <span class="w-7 text-right text-[10px] uppercase tracking-wide text-slate-600">cpu</span>
          <div class="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
            <div class="h-full rounded-full bg-ok/80" :style="{ width: barW(stat.cpuPercent) }" />
          </div>
          <span class="w-10 text-right font-mono text-[10px] tabular-nums text-slate-500">{{ stat.cpuPercent != null ? stat.cpuPercent + '%' : '—' }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-7 text-right text-[10px] uppercase tracking-wide text-slate-600">ram</span>
          <div class="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
            <div class="h-full rounded-full bg-sky-400/80" :style="{ width: barW(stat.memPercent) }" />
          </div>
          <span class="w-10 text-right font-mono text-[10px] tabular-nums text-slate-500">{{ formatBytes(stat.memBytes) }}</span>
        </div>
      </div>

      <!-- status: quiet dot when healthy, loud pill when exceptional -->
      <span
        v-if="service.state === 'running' && (!service.health || service.health === 'healthy')"
        class="h-2 w-2 shrink-0 rounded-full bg-ok"
        :title="service.health ? 'running (healthy)' : 'running'"
      />
      <StatusPill v-else :state="service.state" :health="service.health" />
    </div>

    <LogsPanel v-if="showLogs" :id="service.id" :name="service.displayName" @close="showLogs = false" />
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = defineProps<{ service: Service }>()
const host = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const showLogs = ref(false)
const primaryDomain = computed(() => props.service.domains[0] ?? null)
const barW = (v: number | null | undefined) => `${Math.min(100, Math.max(2, v ?? 0))}%`

const { caps } = useCapabilities()
const updates = useUpdates()
const updateAvailable = computed(() => updates.entryFor(props.service)?.status === 'update')

const { stats, history, refresh: refreshStats } = useStats()
const stat = computed(() => stats.value[props.service.id])
const cpuHistory = computed(() => history.value[props.service.id]?.cpu ?? [])
const memHistory = computed(() => history.value[props.service.id]?.mem ?? [])

const { pings } = usePings()
function pingClass(url: string) {
  const p = pings.value[url]
  if (!p) return ''
  if (p.status === 0) return 'bg-red-400'
  if (p.status < 400) return 'bg-ok'
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
async function control(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !window.confirm(`Stop “${props.service.displayName}”?`)) return
  busy.value = true
  try {
    await $fetch('/api/control', { method: 'POST', body: { id: props.service.id, action } })
    await refreshServices()
    refreshStats()
  } catch (e: any) {
    window.alert(errMsg(e, 'Action failed'))
  } finally {
    busy.value = false
  }
}
</script>
