<template>
  <slot v-if="!loaded || on" />
  <div v-else class="card">
    <EmptyState :icon="icon" :title="`${feature} is turned off`">
      {{ text }}
      <template v-if="!caps.viewer" #actions>
        <NuxtLink to="/settings?tab=capabilities" class="btn btn-primary btn-sm">Turn it on in Settings</NuxtLink>
      </template>
      <template v-else #actions><span class="text-xs text-slate-500">Ask the admin to turn it on.</span></template>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
// Wraps a page whose feature is an opt-in capability. The sidebar keeps those
// pages visible (dimmed) so they can be discovered; this explains what the
// page does and where to switch it on, instead of an API error.
import type { Capabilities } from '~/composables/useCapabilities'

const props = withDefaults(defineProps<{ need: keyof Capabilities; feature: string; text: string; icon?: string }>(), { icon: 'lock' })
const { caps, loaded } = useCapabilities()
const on = computed(() => !!caps.value[props.need])
</script>
