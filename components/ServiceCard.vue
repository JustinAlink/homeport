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
        <p class="truncate font-mono text-[11px] text-slate-500" :title="service.image">
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

    <p class="mt-auto truncate text-[11px] text-slate-500" :title="service.statusText">
      {{ service.statusText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

defineProps<{ service: Service }>()

// Best-effort host for port links: wherever the dashboard itself is opened.
const host = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
</script>
