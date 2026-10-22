<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" :aria-label="`Logs for ${name}`">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="$emit('close')" />
      <div ref="panel" class="relative flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-ink-900 p-4" style="box-shadow: var(--shadow-pop)">
        <div class="flex items-center gap-3 pb-3">
          <Icon name="file-text" class="h-4 w-4 text-slate-500" />
          <span class="text-[14px] font-semibold text-slate-100">{{ name }}</span>
          <span class="text-xs text-slate-500">logs</span>
          <div class="ml-auto flex items-center gap-2">
            <NuxtLink
              :to="`/services/${encodeURIComponent(id)}?tab=logs`"
              class="btn btn-sm"
              title="Open the full logs page"
            >Open page <Icon name="arrow-right" /></NuxtLink>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Close" title="Close (Esc)" @click="$emit('close')"><Icon name="x" /></button>
          </div>
        </div>
        <LogsView :id="id" class="flex-1" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ id: string; name: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => true)

// Esc closes the slide-over, like every other overlay
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
