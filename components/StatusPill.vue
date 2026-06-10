<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
    :class="cls.chip"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="cls.dot" :title="title" />
    {{ cls.label }}
  </span>
</template>

<script setup lang="ts">
import type { HealthState } from '~/types/service'

const props = defineProps<{ state: string; health: HealthState }>()

const cls = computed(() => {
  // Health overrides for a running container.
  if (props.state === 'running' && props.health === 'unhealthy')
    return { label: 'Unhealthy', dot: 'bg-red-400', chip: 'bg-red-500/10 text-red-300' }
  if (props.state === 'running' && props.health === 'starting')
    return { label: 'Starting', dot: 'bg-amber-400 animate-pulse', chip: 'bg-amber-500/10 text-amber-300' }
  if (props.state === 'running')
    return { label: 'Running', dot: 'bg-accent', chip: 'bg-accent/10 text-accent-light' }
  if (props.state === 'failed')
    return { label: 'Failed', dot: 'bg-red-400', chip: 'bg-red-500/10 text-red-300' }
  if (props.state === 'restarting')
    return { label: 'Restarting', dot: 'bg-amber-400 animate-pulse', chip: 'bg-amber-500/10 text-amber-300' }
  if (props.state === 'paused')
    return { label: 'Paused', dot: 'bg-sky-400', chip: 'bg-sky-500/10 text-sky-300' }
  if (props.state === 'created')
    return { label: 'Created', dot: 'bg-slate-400', chip: 'bg-slate-500/10 text-slate-300' }
  return { label: 'Stopped', dot: 'bg-slate-500', chip: 'bg-slate-500/10 text-slate-400' }
})

const title = computed(() => (props.health ? `health: ${props.health}` : props.state))
</script>
