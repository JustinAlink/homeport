<template>
  <section>
    <div class="mb-3 flex items-center gap-3">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">{{ name }}</h2>
      <span class="text-xs text-slate-600">{{ running }}/{{ services.length }}</span>
      <div class="h-px flex-1 bg-white/5" />
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <ServiceCard v-for="s in services" :key="s.id" :service="s" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = defineProps<{ name: string; services: Service[] }>()
const running = computed(() => props.services.filter((s) => s.state === 'running').length)
</script>
