<template>
  <div v-if="fleet" class="grid grid-cols-2 gap-2 md:grid-cols-4">
    <div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">CPU</span>
        <span class="text-sm font-semibold text-slate-100">{{ fleet.cpuPercent }}%</span>
      </div>
      <div class="mt-1.5 h-1 overflow-hidden rounded bg-white/5">
        <div class="h-full rounded bg-accent" :style="{ width: clamp(fleet.cpuPercent) + '%' }" />
      </div>
    </div>

    <div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">RAM</span>
        <span class="text-sm font-semibold text-slate-100">{{ fleet.memPercent }}%</span>
      </div>
      <div class="mt-1.5 h-1 overflow-hidden rounded bg-white/5">
        <div class="h-full rounded" style="background: #38bdf8" :style="{ width: clamp(fleet.memPercent) + '%' }" />
      </div>
      <div class="mt-1 text-[10px] text-slate-500">{{ formatBytes(fleet.memUsed) }} / {{ formatBytes(fleet.memTotal) }}</div>
    </div>

    <div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Running</span>
        <span class="text-sm font-semibold text-slate-100">{{ running }}<span class="text-slate-500">/{{ total }}</span></span>
      </div>
      <div class="mt-1.5 h-1 overflow-hidden rounded bg-white/5">
        <div class="h-full rounded bg-accent" :style="{ width: (total ? (running / total) * 100 : 0) + '%' }" />
      </div>
    </div>

    <div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Cores</span>
        <span class="text-sm font-semibold text-slate-100">{{ fleet.ncpu }}</span>
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
