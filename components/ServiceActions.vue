<template>
  <div class="flex items-center gap-0.5" @click.stop>
    <button
      v-if="caps.logs && service.kind === 'container'"
      class="btn btn-ghost btn-icon btn-sm"
      title="Logs"
      aria-label="View logs"
      @click="$emit('logs')"
    ><Icon name="file-text" class="h-3.5 w-3.5" /></button>
    <template v-if="controlEnabled && service.kind === 'container'">
      <button
        v-if="isUp"
        :disabled="busy"
        class="btn btn-ghost btn-icon btn-sm"
        title="Restart"
        aria-label="Restart"
        @click="$emit('control', 'restart')"
      ><Icon name="refresh" class="h-3.5 w-3.5" :class="busy ? 'animate-spin' : ''" /></button>
      <button
        v-if="isUp"
        :disabled="busy"
        class="btn btn-ghost btn-icon btn-sm hover:!bg-red-500/10 hover:!text-red-300"
        title="Stop"
        aria-label="Stop"
        @click="$emit('control', 'stop')"
      ><Icon name="square" class="h-3.5 w-3.5" /></button>
      <button
        v-else
        :disabled="busy"
        class="btn btn-ghost btn-icon btn-sm hover:!bg-ok/10 hover:!text-ok"
        title="Start"
        aria-label="Start"
        @click="$emit('control', 'start')"
      ><Icon :name="busy ? 'refresh' : 'play'" class="h-3.5 w-3.5" :class="busy ? 'animate-spin' : ''" /></button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

// The quick logs / restart / stop|start buttons shown on a container's card or row.
const props = defineProps<{ service: Service; busy: boolean; controlEnabled: boolean }>()
defineEmits<{ logs: []; control: ['start' | 'stop' | 'restart'] }>()
const { caps } = useCapabilities()
const isUp = computed(() => props.service.state === 'running' || props.service.state === 'restarting')
</script>
