<template>
  <span
    v-if="dotOnly"
    class="dot"
    :class="cls.dot"
    :title="text || cls.label"
  />
  <span
    v-else-if="compact"
    class="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap text-xs"
    :class="cls.text"
    :title="title"
  >
    <span class="dot" :class="cls.dot" />
    <span class="truncate">{{ cls.calm && text ? text : cls.label }}</span>
  </span>
  <span
    v-else
    class="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium"
    :class="cls.chip"
    :title="title"
  >
    <span class="dot h-1.5 w-1.5" :class="cls.dot" />
    {{ cls.label }}
  </span>
</template>

<script setup lang="ts">
import type { HealthState } from '~/types/service'

// Container state as a coloured dot + label. `compact` is the quiet inline form
// used on cards (a healthy container shows its uptime instead of "Running").
const props = defineProps<{ state: string; health: HealthState; text?: string; compact?: boolean; dotOnly?: boolean }>()

const cls = computed(() => {
  // Health overrides for a running container.
  if (props.state === 'running' && props.health === 'unhealthy')
    return { label: 'Unhealthy', dot: 'bg-red-400', chip: 'bg-red-500/10 text-red-300', text: 'text-red-300', calm: false }
  if (props.state === 'running' && props.health === 'starting')
    return { label: 'Starting', dot: 'bg-amber-400 animate-pulse', chip: 'bg-amber-500/10 text-amber-300', text: 'text-amber-300', calm: false }
  if (props.state === 'running')
    return { label: 'Running', dot: 'bg-ok shadow-[0_0_0_3px] shadow-ok/15', chip: 'bg-ok/10 text-ok', text: 'text-slate-400', calm: true }
  if (props.state === 'failed' || props.state === 'dead')
    return { label: props.state === 'dead' ? 'Dead' : 'Failed', dot: 'bg-red-400', chip: 'bg-red-500/10 text-red-300', text: 'text-red-300', calm: false }
  if (props.state === 'restarting')
    return { label: 'Restarting', dot: 'bg-amber-400 animate-pulse', chip: 'bg-amber-500/10 text-amber-300', text: 'text-amber-300', calm: false }
  if (props.state === 'paused')
    return { label: 'Paused', dot: 'bg-sky-400', chip: 'bg-sky-500/10 text-sky-300', text: 'text-sky-300', calm: false }
  if (props.state === 'created')
    return { label: 'Created', dot: 'bg-slate-400', chip: 'bg-white/[0.06] text-slate-300', text: 'text-slate-400', calm: false }
  return { label: 'Stopped', dot: 'bg-slate-500', chip: 'bg-white/[0.06] text-slate-400', text: 'text-slate-500', calm: false }
})

const title = computed(() => (props.health ? `${props.state} · health: ${props.health}` : props.text || props.state))
</script>
