<template>
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <!-- CPU -->
    <div class="card p-4">
      <div class="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon name="cpu" class="h-3.5 w-3.5 text-slate-500" /> CPU
      </div>
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">{{ fleet ? fleet.cpuPercent : '·' }}</span>
        <span v-if="fleet" class="text-sm text-slate-500">%</span>
        <span v-if="fleet" class="ml-auto text-[11.5px] text-slate-500">{{ fleet.ncpu }} {{ fleet.ncpu === 1 ? 'core' : 'cores' }}</span>
      </div>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div class="h-full rounded-full bg-ok transition-all duration-700" :style="{ width: clamp(fleet?.cpuPercent ?? 0) + '%' }" />
      </div>
    </div>

    <!-- Memory -->
    <div class="card p-4">
      <div class="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon name="memory" class="h-3.5 w-3.5 text-slate-500" /> Memory
      </div>
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">{{ fleet ? (fleet.system ? fleet.system.memPercent : fleet.memPercent) : '·' }}</span>
        <span v-if="fleet" class="text-sm text-slate-500">%</span>
        <span v-if="fleet" class="ml-auto truncate text-[11.5px] text-slate-500">
          {{ formatBytes(fleet.system ? fleet.system.memUsed : fleet.memUsed) }} / {{ formatBytes(fleet.system ? fleet.system.memTotal : fleet.memTotal) }}
        </span>
      </div>
      <div
        class="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
        :title="fleet?.system ? `containers ${formatBytes(fleet.memUsed)} · rest of the system ${formatBytes(Math.max(0, fleet.system.memUsed - fleet.memUsed))}` : ''"
      >
        <div class="h-full bg-sky-400 transition-all duration-700" :style="{ width: clamp(fleet?.memPercent ?? 0) + '%' }" />
        <div v-if="fleet?.system" class="h-full bg-amber-400/80 transition-all duration-700" :style="{ width: clamp(fleet.system.memPercent - fleet.memPercent) + '%' }" />
      </div>
    </div>

    <!-- Containers -->
    <div class="card p-4">
      <div class="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon name="box" class="h-3.5 w-3.5 text-slate-500" /> Containers
      </div>
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">{{ running }}</span>
        <span class="text-sm text-slate-500">/ {{ total }} running</span>
      </div>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div class="h-full rounded-full bg-ok transition-all duration-700" :style="{ width: (total ? (running / total) * 100 : 0) + '%' }" />
      </div>
    </div>

    <!-- Updates (when update checks are on), otherwise host capacity -->
    <NuxtLink v-if="updates != null" to="/updates" class="card group p-4 transition-colors hover:border-white/[0.16]">
      <div class="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon name="arrow-up" class="h-3.5 w-3.5 text-slate-500" /> Updates
        <Icon name="chevron-right" class="ml-auto h-3.5 w-3.5 text-slate-600 transition-colors group-hover:text-slate-300" />
      </div>
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums tracking-tight" :class="updates ? 'text-sky-300' : 'text-slate-100'">{{ updates }}</span>
        <span class="text-sm text-slate-500">{{ updates === 1 ? 'image' : 'images' }} behind</span>
      </div>
      <p class="mt-2.5 text-[11.5px] text-slate-500">{{ updates ? 'Review and apply on the Updates page' : 'Everything is up to date' }}</p>
    </NuxtLink>
    <div v-else class="card p-4">
      <div class="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon name="server" class="h-3.5 w-3.5 text-slate-500" /> Host
      </div>
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">{{ fleet?.ncpu ?? '·' }}</span>
        <span class="text-sm text-slate-500">cores</span>
      </div>
      <p class="mt-2.5 text-[11.5px] text-slate-500">{{ fleet ? formatBytes(fleet.memTotal) + ' RAM' : '' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HostStats } from '~/types/service'
defineProps<{ fleet: HostStats | null; running: number; total: number; updates?: number | null }>()
const clamp = (v: number) => Math.min(100, Math.max(0, v))
</script>
