<template>
  <div v-if="fleet" class="grid grid-cols-2 gap-4 md:grid-cols-4">
    <div class="rounded-2xl border border-white/10 bg-ink-900 px-4 py-3.5">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">CPU</span>
        <span class="text-lg font-semibold tabular-nums text-slate-100">{{ fleet.cpuPercent }}%</span>
      </div>
      <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div class="h-full rounded bg-ok" :style="{ width: clamp(fleet.cpuPercent) + '%' }" />
      </div>
    </div>

    <div class="rounded-2xl border border-white/10 bg-ink-900 px-4 py-3.5">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">RAM</span>
        <span class="text-lg font-semibold tabular-nums text-slate-100">{{ fleet.system ? fleet.system.memPercent : fleet.memPercent }}%</span>
      </div>
      <div class="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/5" :title="fleet.system ? 'blue = containers · amber = rest of the system' : ''">
        <div class="h-full" style="background: #38bdf8" :style="{ width: clamp(fleet.memPercent) + '%' }" />
        <div v-if="fleet.system" class="h-full" style="background: #f59e0b" :style="{ width: clamp(fleet.system.memPercent - fleet.memPercent) + '%' }" />
      </div>
      <div class="mt-1 text-[10px] text-slate-500">
        <template v-if="fleet.system">
          {{ formatBytes(fleet.system.memUsed) }} / {{ formatBytes(fleet.system.memTotal) }}
          <span class="text-slate-600">· containers {{ formatBytes(fleet.memUsed) }}</span>
        </template>
        <template v-else>{{ formatBytes(fleet.memUsed) }} / {{ formatBytes(fleet.memTotal) }}</template>
      </div>
    </div>

    <div class="rounded-2xl border border-white/10 bg-ink-900 px-4 py-3.5">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Running</span>
        <span class="text-lg font-semibold tabular-nums text-slate-100">{{ running }}<span class="text-slate-500">/{{ total }}</span></span>
      </div>
      <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div class="h-full rounded bg-ok" :style="{ width: (total ? (running / total) * 100 : 0) + '%' }" />
      </div>
    </div>

    <div class="rounded-2xl border border-white/10 bg-ink-900 px-4 py-3.5">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Cores</span>
        <span class="text-lg font-semibold tabular-nums text-slate-100">{{ fleet.ncpu }}</span>
      </div>
      <div class="mt-1 text-[10px] text-slate-500">host capacity</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HostStats } from '~/types/service'
defineProps<{ fleet: HostStats | null; running: number; total: number }>()
const clamp = (v: number) => Math.min(100, Math.max(0, v))
</script>
