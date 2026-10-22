<template>
  <NuxtLink
    v-if="layout === 'row'"
    :to="stackLink"
    class="flex items-center gap-3 px-3 py-2.5 text-slate-400 transition-colors hover:bg-white/[0.025] sm:px-4"
    :title="hint"
  >
    <span class="shrink-0 opacity-50 grayscale"><ServiceIcon :name="name" :size="30" :remote="remoteIcons" /></span>
    <div class="min-w-0 flex-1 sm:w-0 sm:flex-[1.4]">
      <div class="truncate text-[13.5px] font-medium text-slate-300">{{ name }}</div>
      <div v-if="image" class="truncate font-mono text-[11px] text-slate-500">{{ image }}</div>
    </div>
    <span class="inline-flex w-36 shrink-0 items-center gap-1.5 text-xs text-slate-500"><span class="dot border border-slate-500 bg-transparent" />Not running</span>
    <span class="hidden flex-1 text-xs text-slate-500 lg:block">no container: start the stack to create it</span>
  </NuxtLink>
  <NuxtLink
    v-else
    :to="stackLink"
    class="flex flex-col rounded-xl border border-dashed border-white/[0.14] px-4 py-3.5 transition-colors hover:border-white/25 hover:bg-white/[0.02]"
    :title="hint"
  >
    <div class="flex items-start gap-3">
      <div class="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white/[0.03] opacity-50 grayscale">
        <ServiceIcon :name="name" :size="26" :remote="remoteIcons" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[14.5px] font-semibold text-slate-300">{{ name }}</div>
        <div v-if="image" class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{{ image }}</div>
      </div>
      <span class="inline-flex h-7 shrink-0 items-center gap-1.5 text-xs text-slate-500"><span class="dot border border-slate-500 bg-transparent" />Not running</span>
    </div>
    <p class="mt-3 text-xs text-slate-500">In the compose file, but there's no container. Start the stack to create it.</p>
  </NuxtLink>
</template>

<script setup lang="ts">
// A service the stack's compose file declares but that has no container: the
// stack was taken down, or this service failed to start. Shown so a stack's
// card set always matches its compose file.
const props = withDefaults(defineProps<{ name: string; image?: string; stack: string; layout?: 'card' | 'row' }>(), { layout: 'card' })
const { data } = useServices()
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const stackLink = computed(() => `/stacks/${encodeURIComponent(props.stack)}`)
const hint = computed(() => `${props.name} is declared in ${props.stack}'s compose file but has no container`)
</script>
