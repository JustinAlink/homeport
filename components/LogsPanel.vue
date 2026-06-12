<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end">
      <div class="absolute inset-0 bg-black/60" @click="$emit('close')" />
      <div class="relative flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-ink-950 p-4 shadow-2xl">
        <div class="flex items-center gap-3 pb-3">
          <span class="text-sm font-medium text-slate-100">Logs</span>
          <span class="truncate font-mono text-xs text-slate-500">{{ name }}</span>
          <div class="ml-auto flex items-center gap-2">
            <NuxtLink
              :to="`/services/${encodeURIComponent(id)}`"
              class="rounded border border-white/10 px-2 py-1 text-xs text-slate-400 hover:bg-white/5"
              title="Open the service page"
            >Open page ↗</NuxtLink>
            <button class="rounded border border-white/10 px-2 py-1 text-xs text-slate-400 hover:bg-white/5" @click="$emit('close')">✕</button>
          </div>
        </div>
        <LogsView :id="id" class="flex-1" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ id: string; name: string }>()
defineEmits<{ close: [] }>()
</script>
